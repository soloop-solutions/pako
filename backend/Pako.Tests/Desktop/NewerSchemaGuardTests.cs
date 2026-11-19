using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Desktop;
using Pako.Infrastructure;

namespace Pako.Tests.Desktop;

public sealed class NewerSchemaGuardTests : IAsyncLifetime
{
    private const string Secret = "s3cret";
    private const string FutureMigration = "29991231000000_FromANewerPako";

    private PakoDbContext _db = null!;
    private string _dataDir = null!;

    public async Task InitializeAsync()
    {
        _db = await PostgresTestDatabase.CreateAsync();
        _dataDir = Directory.CreateTempSubdirectory("pako-schema-guard-").FullName;
    }

    public async Task DisposeAsync()
    {
        await _db.DisposeAsync();
        Directory.Delete(_dataDir, recursive: true);
    }

    private Task InsertFutureMigration() =>
        _db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES ({0}, '99.0.0')", FutureMigration);

    private WebApplicationFactory<Program> Build(bool desktop) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("ConnectionStrings:Default", _db.Database.GetConnectionString()!);
            b.UseSetting("Jwt:Key", new string('k', 48));
            b.UseSetting("Desktop:Enabled", desktop ? "true" : "false");
            b.UseSetting("Desktop:LaunchSecret", Secret);
            b.UseSetting("Desktop:DataDirectory", _dataDir);
        });

    [Fact]
    public async Task UnknownAppliedMigrations_ListsOnlyIdsThisBuildDoesNotKnow()
    {
        Assert.Empty(await SchemaGuard.UnknownAppliedMigrationsAsync(_db.Database));

        await InsertFutureMigration();

        Assert.Equal([FutureMigration], await SchemaGuard.UnknownAppliedMigrationsAsync(_db.Database));
    }

    [Fact]
    public async Task Desktop_RefusesToStart_OnANewerSchema_WithItsExitCode()
    {
        await InsertFutureMigration();
        var apiDll = Path.Combine(AppContext.BaseDirectory, "Pako.Api.dll");
        var start = new ProcessStartInfo("dotnet")
        {
            ArgumentList = { apiDll },
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            WorkingDirectory = AppContext.BaseDirectory,
        };
        start.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
        start.Environment["ASPNETCORE_URLS"] = "http://127.0.0.1:0";
        start.Environment["ConnectionStrings__Default"] = _db.Database.GetConnectionString()!;
        start.Environment["Jwt__Key"] = new string('k', 48);
        start.Environment["Desktop__Enabled"] = "true";
        start.Environment["Desktop__LaunchSecret"] = Secret;
        start.Environment["Desktop__DataDirectory"] = _dataDir;

        using var process = Process.Start(start)!;
        var stderr = process.StandardError.ReadToEndAsync();
        var stdout = process.StandardOutput.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw;
        }

        Assert.Equal(SchemaGuard.NewerSchemaExitCode, process.ExitCode);
        Assert.Contains("newer version of PAKO", await stderr);
        Assert.Contains(FutureMigration, await stderr);
        Assert.DoesNotContain("Now listening", await stdout);
        Assert.Equal(1, await _db.Database.SqlQueryRaw<int>(
            "SELECT count(*)::int AS \"Value\" FROM \"__EFMigrationsHistory\" WHERE \"MigrationId\" = {0}", FutureMigration).SingleAsync());
    }

    [Fact]
    public async Task Desktop_StartsNormally_WhenEveryAppliedMigrationIsKnown()
    {
        using var factory = Build(desktop: true);
        using var client = factory.CreateClient();

        var health = await client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
    }

    [Fact]
    public async Task Hosted_IsNotGuarded_AndStillStartsOnANewerSchema()
    {
        await InsertFutureMigration();
        using var factory = Build(desktop: false);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/desktop/setup");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
