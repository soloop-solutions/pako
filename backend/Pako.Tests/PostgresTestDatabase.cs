using Microsoft.EntityFrameworkCore;
using Npgsql;
using Pako.Infrastructure;

namespace Pako.Tests;

// P0.5: tests run against the same real Postgres instance backend/docker-compose.yml brings up
// (no Docker daemon available inside the agent sandbox that wrote this, so Testcontainers itself
// isn't an option there — see the P0.5 handoff note). Each call gets its own schema, migrated
// fresh and never reused, which is the same isolation guarantee UseInMemoryDatabase(Guid.NewGuid())
// gave every test before: a brand-new, empty, independent store per call. Unlike InMemory, this
// one has real unique indexes, triggers, transactions and row locks, which is the entire point —
// B5's gapless numbering and any post-and-pay atomicity test are meaningless without them.
internal static class PostgresTestDatabase
{
    private static readonly string AdminConnectionString =
        Environment.GetEnvironmentVariable("PAKO_TEST_POSTGRES_CONNECTION")
        ?? "Host=localhost;Port=5433;Database=pako_dev;Username=postgres;Password=postgres";

    // Runs once per test process, before the first schema is created (a static constructor is
    // guaranteed by the CLR to run exactly once and to block every caller until it completes) —
    // sweeps schemas left behind by a run that crashed or was cancelled before it could clean up
    // after itself. Safe to run concurrently with nothing else, since nothing has created a
    // "test_*" schema yet at this point.
    static PostgresTestDatabase()
    {
        using var admin = new NpgsqlConnection(AdminConnectionString);
        admin.Open();

        var staleSchemas = new List<string>();
        using (var list = admin.CreateCommand())
        {
            list.CommandText = "select schema_name from information_schema.schemata where schema_name like 'test\\_%' escape '\\'";
            using var reader = list.ExecuteReader();
            while (reader.Read()) staleSchemas.Add(reader.GetString(0));
        }

        // One DROP per statement/transaction, not one big DO block wrapping all of them — with
        // 100+ leftover schemas (each a full migrated copy of the schema) in flight at once, a
        // single transaction holding every one of their locks blows past Postgres's shared-memory
        // lock table (error 53200) before it ever gets to the first DROP.
        foreach (var schema in staleSchemas)
        {
            using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP SCHEMA \"{schema}\" CASCADE";
            drop.ExecuteNonQuery();
        }
    }

    public static async Task<PakoDbContext> CreateAsync()
    {
        var schema = $"test_{Guid.NewGuid():N}";

        await using (var admin = new NpgsqlConnection(AdminConnectionString))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE SCHEMA \"{schema}\"";
            await create.ExecuteNonQueryAsync();
        }

        // Search Path scopes every unqualified table reference EF generates — including
        // __EFMigrationsHistory — to this schema, so PakoDbContext itself needs no schema
        // awareness at all. Pooling is off deliberately: every test gets a schema unique to it,
        // so a pooled-but-idle connection is never reused by anyone — it would just sit open
        // against Postgres's max_connections for its default 300s idle lifetime instead of
        // actually closing when the owning DbContext is disposed.
        var connectionString = new NpgsqlConnectionStringBuilder(AdminConnectionString) { SearchPath = schema, Pooling = false }.ConnectionString;
        var options = new DbContextOptionsBuilder<PakoDbContext>().UseNpgsql(connectionString).Options;

        var db = new PakoDbContext(options);
        await db.Database.MigrateAsync();
        return db;
    }
}
