using System.IO.Compression;
using System.Text;
using Npgsql;

namespace Pako.Api.Services;

/// <summary>
/// Keeps a developer's local database on the committed demo data set (backend/seed/pako_demo.sql.gz).
/// Development only, behind <c>Demo:AutoLoad</c>. When the version in backend/seed/pako_demo.version
/// differs from the one recorded in the database, the database is renamed to
/// <c>{name}_backup_{yyyyMMddHHmmss}</c> (the three newest backups are kept), recreated and loaded
/// from the dump. Migrations then run as usual. Refuses any host other than localhost.
/// </summary>
public static class DemoDatabaseSync
{
    public const string MarkerTable = "__pako_demo_seed";
    const int BackupsKept = 3;

    public static async Task RunAsync(IConfiguration configuration, IHostEnvironment environment, ILogger logger)
    {
        if (!environment.IsDevelopment() || !configuration.GetValue("Demo:AutoLoad", false)) return;

        var seedDirectory = Path.GetFullPath(configuration["Demo:SeedDirectory"]
            ?? Path.Combine(environment.ContentRootPath, "..", "seed"));
        var dumpPath = Path.Combine(seedDirectory, "pako_demo.sql.gz");
        var versionPath = Path.Combine(seedDirectory, "pako_demo.version");
        if (!File.Exists(dumpPath) || !File.Exists(versionPath))
        {
            logger.LogInformation("Demo data: no seed found in {Directory}; skipped", seedDirectory);
            return;
        }
        var version = (await File.ReadAllTextAsync(versionPath)).Trim();

        var target = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("Default"));
        if (target.Host is not ("localhost" or "127.0.0.1" or "::1"))
        {
            logger.LogWarning("Demo data: database host {Host} is not local; never loading demo data there", target.Host);
            return;
        }
        var database = target.Database ?? throw new InvalidOperationException("The connection string names no database.");
        var admin = new NpgsqlConnectionStringBuilder(target.ConnectionString) { Database = "postgres", Pooling = false };

        await using (var server = new NpgsqlConnection(admin.ConnectionString))
        {
            await server.OpenAsync();
            var exists = await ScalarAsync<bool>(server, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = @db)", database);
            if (exists)
            {
                var current = await LoadedVersionAsync(target, database);
                if (current == version) return;
                var backup = $"{database}_backup_{DateTime.Now:yyyyMMddHHmmss}";
                logger.LogWarning("Demo data: database {Database} is on {Current}, the repository on {Version}. "
                    + "Keeping the old database as {Backup} and loading the demo set.", database, current ?? "local data", version, backup);
                await ExecAsync(server, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", database);
                await ExecAsync(server, $"ALTER DATABASE {Quote(database)} RENAME TO {Quote(backup)}");
                await PruneBackupsAsync(server, database, logger);
            }
            else
            {
                logger.LogInformation("Demo data: creating {Database} from the demo set {Version}", database, version);
            }
            await ExecAsync(server, $"CREATE DATABASE {Quote(database)}");
        }

        var load = new NpgsqlConnectionStringBuilder(target.ConnectionString) { Pooling = false, CommandTimeout = 0 };
        await using (var connection = new NpgsqlConnection(load.ConnectionString))
        {
            await connection.OpenAsync();
            await LoadDumpAsync(connection, dumpPath);
            // A dump built before the marker existed still records its version.
            await ExecAsync(connection, $"CREATE TABLE IF NOT EXISTS public.{MarkerTable} (version text NOT NULL)");
            await ExecAsync(connection, $"DELETE FROM public.{MarkerTable}");
            await ExecAsync(connection, $"INSERT INTO public.{MarkerTable} (version) VALUES (@db)", version);
        }
        NpgsqlConnection.ClearAllPools();
        logger.LogWarning("Demo data: {Database} loaded from {Version}. Logins: docs/DEMO_ACCOUNTS.md", database, version);
    }

    static async Task<string?> LoadedVersionAsync(NpgsqlConnectionStringBuilder target, string database)
    {
        var builder = new NpgsqlConnectionStringBuilder(target.ConnectionString) { Database = database, Pooling = false };
        await using var connection = new NpgsqlConnection(builder.ConnectionString);
        await connection.OpenAsync();
        var hasMarker = await ScalarAsync<bool>(connection, $"SELECT to_regclass('public.{MarkerTable}') IS NOT NULL", null);
        if (!hasMarker) return null;
        await using var command = new NpgsqlCommand($"SELECT version FROM public.{MarkerTable} LIMIT 1", connection);
        return await command.ExecuteScalarAsync() as string;
    }

    static async Task PruneBackupsAsync(NpgsqlConnection server, string database, ILogger logger)
    {
        var backups = new List<string>();
        await using (var command = new NpgsqlCommand(
            "SELECT datname FROM pg_database WHERE datname LIKE @prefix ORDER BY datname DESC", server))
        {
            command.Parameters.AddWithValue("prefix", database.Replace("_", "\\_") + "\\_backup\\_%");
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) backups.Add(reader.GetString(0));
        }
        foreach (var old in backups.Skip(BackupsKept))
        {
            await ExecAsync(server, $"DROP DATABASE IF EXISTS {Quote(old)} WITH (FORCE)");
            logger.LogInformation("Demo data: removed old backup {Backup}", old);
        }
    }

    /// <summary>
    /// Plays a plain pg_dump file: SQL between COPY blocks goes as one multi-statement command, each
    /// COPY block through the COPY protocol. psql meta-commands (<c>\restrict</c>) are skipped.
    /// </summary>
    static async Task LoadDumpAsync(NpgsqlConnection connection, string dumpPath)
    {
        await using var file = File.OpenRead(dumpPath);
        await using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        var sql = new StringBuilder();
        while (await reader.ReadLineAsync() is { } line)
        {
            if (line.StartsWith("COPY ", StringComparison.Ordinal) && line.EndsWith("FROM stdin;", StringComparison.Ordinal))
            {
                await FlushAsync(connection, sql);
                await using var writer = await connection.BeginTextImportAsync(line[..^1]);
                while (await reader.ReadLineAsync() is { } row && row != "\\.")
                {
                    await writer.WriteAsync(row);
                    await writer.WriteAsync('\n');
                }
                continue;
            }
            if (line.StartsWith('\\')) continue;
            sql.Append(line).Append('\n');
        }
        await FlushAsync(connection, sql);
    }

    static async Task FlushAsync(NpgsqlConnection connection, StringBuilder sql)
    {
        if (sql.ToString().Trim().Length == 0) { sql.Clear(); return; }
        await using var command = new NpgsqlCommand(sql.ToString(), connection);
        await command.ExecuteNonQueryAsync();
        sql.Clear();
    }

    static async Task ExecAsync(NpgsqlConnection connection, string sql, string? db = null)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        if (db is not null) command.Parameters.AddWithValue("db", db);
        await command.ExecuteNonQueryAsync();
    }

    static async Task<T> ScalarAsync<T>(NpgsqlConnection connection, string sql, string? db)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        if (db is not null) command.Parameters.AddWithValue("db", db);
        return (T)(await command.ExecuteScalarAsync())!;
    }

    static string Quote(string identifier) => "\"" + identifier.Replace("\"", "\"\"") + "\"";
}
