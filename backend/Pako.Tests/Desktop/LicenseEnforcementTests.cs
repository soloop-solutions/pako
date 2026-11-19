using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pako.Api.Contracts;
using Pako.Api.Desktop;
using Pako.Domain.Desktop;
using Pako.Infrastructure;

namespace Pako.Tests.Desktop;

public sealed class LicenseEnforcementTests : IAsyncLifetime
{
    private const string Secret = "s3cret";
    private const string MachineGuid = "test-machine-guid";

    private sealed class SettableClock(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class FixedMachineId : IMachineIdProvider
    {
        public string GetMachineGuid() => MachineGuid;
    }

    private static readonly DateTimeOffset Start = new(2026, 11, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly LicenseTestKeys _keys = new();
    private readonly SettableClock _clock = new(Start);
    private string _connectionString = null!;
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;
    private PakoDbContext _db = null!;

    public async Task InitializeAsync()
    {
        _db = await PostgresTestDatabase.CreateAsync();
        _connectionString = _db.Database.GetConnectionString()!;
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("ConnectionStrings:Default", _connectionString);
            b.UseSetting("Jwt:Key", new string('k', 48));
            b.UseSetting("Desktop:Enabled", "true");
            b.UseSetting("Desktop:LaunchSecret", Secret);
            b.UseSetting("Platform:AllowSelfRegistration", "true");
            b.ConfigureServices(s =>
            {
                s.RemoveAll<TimeProvider>();
                s.AddSingleton<TimeProvider>(_clock);
                s.RemoveAll<IMachineIdProvider>();
                s.AddSingleton<IMachineIdProvider, FixedMachineId>();
                s.RemoveAll<LicensePublicKeyHolder>();
                s.AddSingleton(new LicensePublicKeyHolder(_keys.PublicKey));
            });
        });
        _client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        _client.DefaultRequestHeaders.Add("Cookie", $"{LaunchSecretMiddleware.CookieName}={Secret}");

        var register = await _client.PostAsJsonAsync("/api/auth/register", new RegisterRequest("owner@x.test", "Passw0rd!123"));
        register.EnsureSuccessStatusCode();
        var auth = (await register.Content.ReadFromJsonAsync<AuthResponse>())!;
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.Token);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        _factory.Dispose();
        await _db.DisposeAsync();
    }

    private static string MachineCodeValue => MachineCode.Compute(MachineGuid);

    private Task<HttpResponseMessage> PostInvoice() =>
        _client.PostAsJsonAsync($"/api/companies/{Guid.NewGuid()}/invoices", new { });

    private async Task<DesktopLicenseResponse> GetLicense()
    {
        var response = await _client.GetAsync("/api/desktop/license");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<DesktopLicenseResponse>())!;
    }

    private void PassTrial() => _clock.Now = Start.AddDays(LicenseState.TrialDays + 1);

    [Fact]
    public async Task Trial_AllowsWrites()
    {
        var response = await PostInvoice();

        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
        var license = await GetLicense();
        Assert.Equal("Trial", license.Status);
        Assert.Equal(MachineCodeValue, license.MachineCode);
    }

    [Fact]
    public async Task ReadOnly_BlocksPost_OnInvoices()
    {
        await GetLicense();
        PassTrial();

        var response = await PostInvoice();

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("LicenseReadOnly", json.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task ReadOnly_AllowsGet_AndExportRoutes()
    {
        await GetLicense();
        PassTrial();

        var list = await _client.GetAsync($"/api/companies/{Guid.NewGuid()}/invoices");
        var export = await _client.GetAsync($"/api/companies/{Guid.NewGuid()}/reports/general-ledger/export");

        Assert.NotEqual(HttpStatusCode.Forbidden, list.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, export.StatusCode);
        Assert.Equal("ReadOnly", (await GetLicense()).Status);
    }

    [Fact]
    public async Task ReadOnly_AllowsLoginAndLicenseActivation()
    {
        await GetLicense();
        PassTrial();

        var login = await _client.PostAsJsonAsync("/api/auth/login", new LoginRequest("owner@x.test", "Passw0rd!123"));
        var key = _keys.Issue(new LicensePayload(MachineCodeValue, "Acme", Start, Start.AddYears(1)));
        var activate = await _client.PostAsJsonAsync("/api/desktop/license", new ActivateLicenseRequest(key));

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Equal(HttpStatusCode.OK, activate.StatusCode);
    }

    [Fact]
    public async Task ActivateLicense_ValidKey_SwitchesToLicensed()
    {
        PassTrial();
        var key = _keys.Issue(new LicensePayload(MachineCodeValue, "Acme", Start, Start.AddYears(1)));

        var response = await _client.PostAsJsonAsync("/api/desktop/license", new ActivateLicenseRequest(key));

        response.EnsureSuccessStatusCode();
        var license = (await response.Content.ReadFromJsonAsync<DesktopLicenseResponse>())!;
        Assert.Equal("Licensed", license.Status);
        Assert.Equal("Acme", license.Customer);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await PostInvoice()).StatusCode);
    }

    [Fact]
    public async Task ActivateLicense_BadKey_Returns400()
    {
        var other = new LicenseTestKeys();
        var forged = other.Issue(new LicensePayload(MachineCodeValue, "Acme", Start, null));
        var wrongMachine = _keys.Issue(new LicensePayload("AAAA-BBBB-CCCC-DDDD", "Acme", Start, null));

        foreach (var key in new[] { "garbage", forged, wrongMachine })
        {
            var response = await _client.PostAsJsonAsync("/api/desktop/license", new ActivateLicenseRequest(key));
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        Assert.Equal("Trial", (await GetLicense()).Status);
    }

    [Fact]
    public async Task Evaluation_CreatesRecordLazily_AndSetBackClockCannotExtendTrial()
    {
        Assert.Equal(0, await _db.DesktopLicenseRecords.CountAsync());

        var first = await GetLicense();
        Assert.Equal(LicenseState.TrialDays, first.TrialDaysLeft);
        Assert.Equal(1, await _db.DesktopLicenseRecords.CountAsync());

        _clock.Now = Start.AddDays(10);
        await GetLicense();
        _clock.Now = Start.AddDays(2);
        var setBack = await GetLicense();

        Assert.Equal(4, setBack.TrialDaysLeft);
        await using var fresh = PostgresTestDatabase.CreateAdditionalContext(_db);
        Assert.Equal(Start.AddDays(10), (await fresh.DesktopLicenseRecords.SingleAsync()).LastSeenAt);
    }
}
