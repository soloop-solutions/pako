using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Desktop;
using Pako.Infrastructure;

namespace Pako.Tests;

public sealed class DesktopModeTests : IAsyncLifetime
{
    private const string Secret = "s3cret";

    private string _connectionString = null!;
    private string _webRoot = null!;
    private WebApplicationFactory<Program> _desktop = null!;
    private WebApplicationFactory<Program> _hosted = null!;
    private string _latestMigration = null!;

    public async Task InitializeAsync()
    {
        await using (var db = await PostgresTestDatabase.CreateAsync())
        {
            _connectionString = db.Database.GetConnectionString()!;
            _latestMigration = (await db.Database.GetAppliedMigrationsAsync()).Last();
        }

        _webRoot = Path.Combine(Path.GetTempPath(), "pako-desktop-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_webRoot);
        await File.WriteAllTextAsync(Path.Combine(_webRoot, "index.html"), "<html>pako-spa</html>");
        Directory.CreateDirectory(Path.Combine(_webRoot, "assets"));
        await File.WriteAllTextAsync(Path.Combine(_webRoot, "assets", "app.js"), "console.log('pako-js');");
        await File.WriteAllTextAsync(Path.Combine(_webRoot, "assets", "app.css"), "body{color:red}");
        await File.WriteAllTextAsync(Path.Combine(_webRoot, "favicon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");

        _desktop = Build(enabled: true);
        _hosted = Build(enabled: false);
    }

    public async Task DisposeAsync()
    {
        _desktop.Dispose();
        _hosted.Dispose();
        try { Directory.Delete(_webRoot, true); } catch (IOException) { }
        await Task.CompletedTask;
    }

    private WebApplicationFactory<Program> Build(bool enabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("ConnectionStrings:Default", _connectionString);
            b.UseSetting("Jwt:Key", new string('k', 48));
            b.UseSetting("Desktop:Enabled", enabled ? "true" : "false");
            b.UseSetting("Desktop:LaunchSecret", Secret);
            b.UseWebRoot(_webRoot);
        });

    private static HttpRequestMessage Get(string path, bool withCookie)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (withCookie) request.Headers.Add("Cookie", $"{LaunchSecretMiddleware.CookieName}={Secret}");
        return request;
    }

    private static HttpClient Client(WebApplicationFactory<Program> f) =>
        f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    [Fact]
    public async Task Healthz_ReturnsOkWithoutSecret()
    {
        var response = await Client(_desktop).SendAsync(Get("/healthz", false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ok", json.RootElement.GetProperty("status").GetString());
        Assert.Equal(_latestMigration, json.RootElement.GetProperty("schemaVersion").GetString());
    }

    [Fact]
    public async Task Api_Returns403_WithoutLaunchCookie()
    {
        var response = await Client(_desktop).SendAsync(Get("/api/companies", false));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Api_Returns403_WithWrongLaunchCookie()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/companies");
        request.Headers.Add("Cookie", $"{LaunchSecretMiddleware.CookieName}=nope");

        var response = await Client(_desktop).SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Api_Allows_WithLaunchCookie()
    {
        var response = await Client(_desktop).SendAsync(Get("/api/companies", true));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Static_Index_ServedWithoutSecret()
    {
        var response = await Client(_desktop).SendAsync(Get("/index.html", false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("pako-spa", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task SpaFallback_ServesIndexForUnknownRoute()
    {
        var response = await Client(_desktop).SendAsync(Get("/invoices/123", false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("pako-spa", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task SpaFallback_DoesNotServeIndexForUnknownApiRoute()
    {
        var response = await Client(_desktop).SendAsync(Get("/api/does-not-exist", true));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Hub_Rejects_WithoutLaunchCookie()
    {
        var withoutCookie = new HttpRequestMessage(HttpMethod.Post, "/hubs/pos/negotiate?negotiateVersion=1");
        var withCookie = new HttpRequestMessage(HttpMethod.Post, "/hubs/pos/negotiate?negotiateVersion=1");
        withCookie.Headers.Add("Cookie", $"{LaunchSecretMiddleware.CookieName}={Secret}");

        Assert.Equal(HttpStatusCode.Forbidden, (await Client(_desktop).SendAsync(withoutCookie)).StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await Client(_desktop).SendAsync(withCookie)).StatusCode);
    }

    [Fact]
    public async Task Root_ServesIndexHtml()
    {
        var response = await Client(_desktop).SendAsync(Get("/", false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.StartsWith("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("pako-spa", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Assets_AreServedAsRealFiles_NotIndexHtml()
    {
        var client = Client(_desktop);

        var js = await client.SendAsync(Get("/assets/app.js", false));
        Assert.Equal(HttpStatusCode.OK, js.StatusCode);
        Assert.Contains("javascript", js.Content.Headers.ContentType?.MediaType);
        Assert.Equal("console.log('pako-js');", await js.Content.ReadAsStringAsync());

        var css = await client.SendAsync(Get("/assets/app.css", false));
        Assert.Equal(HttpStatusCode.OK, css.StatusCode);
        Assert.Equal("text/css", css.Content.Headers.ContentType?.MediaType);
        Assert.Equal("body{color:red}", await css.Content.ReadAsStringAsync());

        var svg = await client.SendAsync(Get("/favicon.svg", false));
        Assert.Equal(HttpStatusCode.OK, svg.StatusCode);
        Assert.Equal("image/svg+xml", svg.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task ClientRoute_ServesIndexHtml()
    {
        var response = await Client(_desktop).SendAsync(Get("/some/client/route", false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.StartsWith("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("pako-spa", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task MissingAsset_Returns404_NotIndexHtml()
    {
        var response = await Client(_desktop).SendAsync(Get("/assets/missing.js", false));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("/api")]
    [InlineData("/api/unknown")]
    [InlineData("/hubs/unknown")]
    public async Task UnknownApiAndHubPaths_Return404WithCookie_And403Without(string path)
    {
        var client = Client(_desktop);

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get(path, true))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(Get(path, false))).StatusCode);
    }

    [Fact]
    public async Task Disabled_LeavesHostedBehaviourUnchanged()
    {
        var client = Client(_hosted);

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get("/healthz", false))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(Get("/api/companies", false))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get("/invoices/123", false))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Get("/", false))).StatusCode);
        Assert.Equal("console.log('pako-js');", await client.GetStringAsync("/assets/app.js"));
    }
}
