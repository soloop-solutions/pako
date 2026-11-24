using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pako.Api.Contracts;
using Pako.Api.Desktop;
using Pako.Infrastructure;

namespace Pako.Tests.Desktop;

// Desktop "Allow tills on this network": the API also listens on a till port on the shop LAN.
// Through that port only connected till devices reach the API; the PC's own window is unchanged.
public sealed class TillNetworkTests : IAsyncLifetime
{
    private const string Secret = "s3cret";
    private const string Email = "owner@x.test";
    private const string Password = "Passw0rd!123";
    private const int TillPort = 5300;
    private const string PortHeader = "X-Test-Local-Port";

    private PakoDbContext _db = null!;
    private string _webRoot = null!;
    private WebApplicationFactory<Program> _tills = null!;
    private WebApplicationFactory<Program> _off = null!;

    // TestServer has no real sockets: this sets the port a request "arrived on".
    private sealed class LocalPortFromHeader : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((context, nextMiddleware) =>
            {
                if (int.TryParse(context.Request.Headers[PortHeader], out var port)) context.Connection.LocalPort = port;
                return nextMiddleware(context);
            });
            next(app);
        };
    }

    public async Task InitializeAsync()
    {
        _db = await PostgresTestDatabase.CreateAsync();
        _webRoot = Path.Combine(Path.GetTempPath(), "pako-tills-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_webRoot);
        await File.WriteAllTextAsync(Path.Combine(_webRoot, "index.html"), "<html>pako-spa</html>");
        _tills = Build(TillPort);
        _off = Build(0);
    }

    public async Task DisposeAsync()
    {
        _tills.Dispose();
        _off.Dispose();
        await _db.DisposeAsync();
        try { Directory.Delete(_webRoot, true); } catch (IOException) { }
    }

    private WebApplicationFactory<Program> Build(int tillPort) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("ConnectionStrings:Default", _db.Database.GetConnectionString()!);
            b.UseSetting("Jwt:Key", new string('k', 48));
            b.UseSetting("Desktop:Enabled", "true");
            b.UseSetting("Desktop:LaunchSecret", Secret);
            b.UseSetting("Desktop:TillPort", tillPort.ToString());
            b.UseWebRoot(_webRoot);
            b.ConfigureServices(s => s.AddSingleton<IStartupFilter, LocalPortFromHeader>());
        });

    // The PC's own window: loopback, with the launch cookie.
    private static HttpClient Pc(WebApplicationFactory<Program> f)
    {
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        c.DefaultRequestHeaders.Add("Cookie", $"{LaunchSecretMiddleware.CookieName}={Secret}");
        return c;
    }

    // A tablet on the shop Wi-Fi: the till port, never a launch cookie.
    private static HttpClient Tablet(WebApplicationFactory<Program> f, string? token = null)
    {
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        c.DefaultRequestHeaders.Add(PortHeader, TillPort.ToString());
        if (token is not null) c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private async Task<(string AdminToken, Guid CompanyId, PosDeviceLinkResponse Link)> AdminWithDeviceLink(WebApplicationFactory<Program> f)
    {
        var pc = Pc(f);
        (await pc.PostAsJsonAsync("/api/desktop/setup", new DesktopSetupRequest(Email, Password, "Owner"))).EnsureSuccessStatusCode();
        var login = await pc.PostAsJsonAsync("/api/auth/login", new LoginRequest(Email, Password));
        login.EnsureSuccessStatusCode();
        var token = (await login.Content.ReadFromJsonAsync<AuthResponse>())!.Token;
        pc.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var created = await pc.PostAsJsonAsync("/api/companies", new CreateCompanyRequest("Te Ura"));
        created.EnsureSuccessStatusCode();
        var company = (await created.Content.ReadFromJsonAsync<CompanyResponse>())!;
        var device = await pc.PostAsJsonAsync($"/api/companies/{company.Id}/pos/devices", new SavePosDeviceRequest("Bar till"));
        Assert.Equal(HttpStatusCode.OK, device.StatusCode);
        return (token, company.Id, (await device.Content.ReadFromJsonAsync<PosDeviceLinkResponse>())!);
    }

    [Fact]
    public async Task Tablet_LoadsTheApp_ButNotUploads()
    {
        var tablet = Tablet(_tills);

        Assert.Equal(HttpStatusCode.OK, (await tablet.GetAsync("/device/connect")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tablet.GetAsync("/uploads/companies/x/stamp.png")).StatusCode);
    }

    [Fact]
    public async Task Tablet_CannotSignIn_SetUp_OrUseAnAdminToken()
    {
        var (adminToken, companyId, _) = await AdminWithDeviceLink(_tills);

        var login = await Tablet(_tills).PostAsJsonAsync("/api/auth/login", new LoginRequest(Email, Password));
        Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Tablet(_tills).GetAsync("/api/desktop/setup")).StatusCode);
        var withAdmin = Tablet(_tills, adminToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await withAdmin.GetAsync("/api/companies")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await withAdmin.GetAsync($"/api/companies/{companyId}/pos/registers")).StatusCode);
    }

    [Fact]
    public async Task Tablet_ConnectsWithTheOneUseLink_AndWorksAsTheDevice()
    {
        var (adminToken, companyId, link) = await AdminWithDeviceLink(_tills);

        var connect = await Tablet(_tills).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest(link.Code));
        Assert.Equal(HttpStatusCode.OK, connect.StatusCode);
        var auth = (await connect.Content.ReadFromJsonAsync<AuthResponse>())!;
        var again = await Tablet(_tills).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest(link.Code));
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);

        var device = Tablet(_tills, auth.Token);
        Assert.Equal(HttpStatusCode.OK, (await device.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await device.GetAsync($"/api/companies/{companyId}/pos/registers")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await device.GetAsync("/api/desktop/license")).StatusCode);
        var refresh = await Tablet(_tills).PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken!));
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);

        // Disconnected in POS setup: the tablet is out at once.
        var pc = Pc(_tills);
        pc.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        (await pc.PostAsync($"/api/companies/{companyId}/pos/devices/{link.DeviceId}/disconnect", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await device.GetAsync($"/api/companies/{companyId}/pos/registers")).StatusCode);
    }

    [Fact]
    public async Task TillPc_ConnectsWithTheShortCode_Once()
    {
        var (_, companyId, link) = await AdminWithDeviceLink(_tills);
        Assert.Matches("^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$", link.PairCode!);

        // Typed on the till PC, in any case and spacing.
        var typed = link.PairCode!.Replace("-", " ").ToLowerInvariant();
        var connect = await Tablet(_tills).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest(typed));
        Assert.Equal(HttpStatusCode.OK, connect.StatusCode);
        var auth = (await connect.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.Equal(HttpStatusCode.OK, (await Tablet(_tills, auth.Token).GetAsync($"/api/companies/{companyId}/pos/registers")).StatusCode);

        // Spent with the link: neither works again.
        Assert.Equal(HttpStatusCode.BadRequest, (await Tablet(_tills).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest(link.PairCode!))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Tablet(_tills).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest(link.Code))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Tablet(_tills).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest("ABCD-EFGH"))).StatusCode);
    }

    [Fact]
    public async Task NewLink_EndsTheOldShortCode()
    {
        var (adminToken, companyId, first) = await AdminWithDeviceLink(_tills);
        var pc = Pc(_tills);
        pc.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var second = (await (await pc.PostAsync($"/api/companies/{companyId}/pos/devices/{first.DeviceId}/link", null)).Content.ReadFromJsonAsync<PosDeviceLinkResponse>())!;

        Assert.Equal(HttpStatusCode.BadRequest, (await Tablet(_tills).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest(first.PairCode!))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Tablet(_tills).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest(second.PairCode!))).StatusCode);
    }

    [Fact]
    public async Task Healthz_OnTheTillPort_SaysItIsPako()
    {
        var onTills = await (await Tablet(_tills).GetAsync("/healthz")).Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("pako", onTills.GetProperty("app").GetString());
        Assert.Equal(Environment.MachineName, onTills.GetProperty("machine").GetString());

        var onPc = await (await Pc(_tills).GetAsync("/healthz")).Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.False(onPc.TryGetProperty("machine", out _));
    }

    [Fact]
    public async Task PcWindow_IsUnchanged()
    {
        var noCookie = _tills.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        Assert.Equal(HttpStatusCode.Forbidden, (await noCookie.GetAsync("/api/companies")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Pc(_tills).GetAsync("/api/companies")).StatusCode);
    }

    [Fact]
    public async Task SettingOff_TheTillPortIsJustAnotherUnguardedPort()
    {
        var response = await Tablet(_off).PostAsJsonAsync("/api/auth/device-connect", new ConnectPosDeviceRequest("x"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
