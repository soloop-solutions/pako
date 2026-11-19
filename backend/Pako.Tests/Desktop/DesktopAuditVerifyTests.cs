using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Desktop;
using Pako.Domain.Companies;
using Pako.Infrastructure;
using Pako.Infrastructure.Audit;

namespace Pako.Tests.Desktop;

public sealed class DesktopAuditVerifyTests : IAsyncLifetime
{
    private const string Secret = "s3cret";

    private sealed class Ambient : IAuditContext
    {
        public string? UserId { get; set; }
        public string? IpAddress { get; set; } = "198.51.100.4";
        public string? RequestId { get; set; } = "req-x";
        public Guid? SourceDocumentId { get; set; }
    }

    private PakoDbContext _db = null!;

    public async Task InitializeAsync() => _db = await PostgresTestDatabase.CreateAsync(new Ambient());

    public async Task DisposeAsync() => await _db.DisposeAsync();

    private WebApplicationFactory<Program> Build(bool enabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("ConnectionStrings:Default", _db.Database.GetConnectionString()!);
            b.UseSetting("Jwt:Key", new string('k', 48));
            b.UseSetting("Desktop:Enabled", enabled ? "true" : "false");
            b.UseSetting("Desktop:LaunchSecret", Secret);
        });

    private static HttpClient Client(WebApplicationFactory<Program> f, bool withCookie = true)
    {
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        if (withCookie) c.DefaultRequestHeaders.Add("Cookie", $"{LaunchSecretMiddleware.CookieName}={Secret}");
        return c;
    }

    private async Task<Company> CompanyWithAuditedRows(string name)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = name };
        _db.Companies.Add(company);
        await _db.SaveChangesAsync();
        _db.Partners.Add(new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = $"{name} partner A" });
        await _db.SaveChangesAsync();
        _db.Partners.Add(new Partner { Id = Guid.NewGuid(), CompanyId = company.Id, Name = $"{name} partner B" });
        await _db.SaveChangesAsync();
        return company;
    }

    [Fact]
    public async Task AuditVerify_NoCompanies_ReturnsOk()
    {
        using var factory = Build(true);
        using var client = Client(factory);

        var response = await client.GetAsync("/api/desktop/audit-verify");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<DesktopAuditVerifyResponse>();
        Assert.True(body!.Ok);
        Assert.Empty(body.Failures);
    }

    [Fact]
    public async Task AuditVerify_IntactChains_ReturnsOk()
    {
        await CompanyWithAuditedRows("Alpha");
        await CompanyWithAuditedRows("Beta");
        using var factory = Build(true);
        using var client = Client(factory);

        var body = await client.GetFromJsonAsync<DesktopAuditVerifyResponse>("/api/desktop/audit-verify");

        Assert.True(body!.Ok);
        Assert.Empty(body.Failures);
    }

    [Fact]
    public async Task AuditVerify_TamperedEntry_ReportsThatCompany()
    {
        await CompanyWithAuditedRows("Alpha");
        var tampered = await CompanyWithAuditedRows("Beta");
        await _db.Database.ExecuteSqlRawAsync("ALTER TABLE audit_entries DISABLE TRIGGER trg_audit_entries_append_only");
        await _db.Database.ExecuteSqlRawAsync(
            "UPDATE audit_entries SET \"Action\" = 'Deleted' WHERE \"SequenceNumber\" = 2 AND \"CompanyId\" = {0}", tampered.Id);
        await _db.Database.ExecuteSqlRawAsync("ALTER TABLE audit_entries ENABLE TRIGGER trg_audit_entries_append_only");
        using var factory = Build(true);
        using var client = Client(factory);

        var body = await client.GetFromJsonAsync<DesktopAuditVerifyResponse>("/api/desktop/audit-verify");

        Assert.False(body!.Ok);
        var failure = Assert.Single(body.Failures);
        Assert.Equal(tampered.Id, failure.CompanyId);
        Assert.Equal(AuditChainVerifier.ReasonEntryHashMismatch, failure.Reason);
    }

    [Fact]
    public async Task AuditVerify_RequiresLaunchCookie()
    {
        using var factory = Build(true);
        using var client = Client(factory, withCookie: false);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/desktop/audit-verify")).StatusCode);
    }

    [Fact]
    public async Task AuditVerify_Absent_WhenDesktopDisabled()
    {
        using var factory = Build(false);
        using var client = Client(factory);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/desktop/audit-verify")).StatusCode);
    }
}
