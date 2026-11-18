using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Api.Desktop;
using Pako.Api.Services;
using Pako.Infrastructure;

namespace Pako.Tests.Desktop;

public sealed class DesktopUploadsTests : IAsyncLifetime
{
    private const string Secret = "s3cret";
    private const string Email = "owner@x.test";
    private const string Password = "Passw0rd!123";
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];

    private PakoDbContext _db = null!;
    private string _dataDir = null!;
    private WebApplicationFactory<Program> _desktop = null!;
    private WebApplicationFactory<Program> _hosted = null!;

    public async Task InitializeAsync()
    {
        _db = await PostgresTestDatabase.CreateAsync();
        _dataDir = Path.Combine(Path.GetTempPath(), "pako-data Ëndrra " + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dataDir);
        _desktop = Build(enabled: true);
        _hosted = Build(enabled: false);
    }

    public async Task DisposeAsync()
    {
        _desktop.Dispose();
        _hosted.Dispose();
        await _db.DisposeAsync();
        try { Directory.Delete(_dataDir, true); } catch (IOException) { }
    }

    private WebApplicationFactory<Program> Build(bool enabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("ConnectionStrings:Default", _db.Database.GetConnectionString()!);
            b.UseSetting("Jwt:Key", new string('k', 48));
            b.UseSetting("Desktop:Enabled", enabled ? "true" : "false");
            b.UseSetting("Desktop:LaunchSecret", Secret);
            b.UseSetting("Desktop:DataDirectory", _dataDir);
        });

    private static HttpClient Client(WebApplicationFactory<Program> f, bool withCookie = true)
    {
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        if (withCookie) c.DefaultRequestHeaders.Add("Cookie", $"{LaunchSecretMiddleware.CookieName}={Secret}");
        return c;
    }

    private async Task<(HttpClient Client, Guid CompanyId)> SignedInWithCompany()
    {
        var client = Client(_desktop);
        (await client.PostAsJsonAsync("/api/desktop/setup", new DesktopSetupRequest(Email, Password, "Owner"))).EnsureSuccessStatusCode();
        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(Email, Password));
        login.EnsureSuccessStatusCode();
        var auth = (await login.Content.ReadFromJsonAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.Token);
        var created = await client.PostAsJsonAsync("/api/companies", new CreateCompanyRequest("Acme"));
        created.EnsureSuccessStatusCode();
        var company = (await created.Content.ReadFromJsonAsync<CompanyResponse>())!;
        return (client, company.Id);
    }

    private static Task<HttpResponseMessage> UploadLogo(HttpClient client, Guid companyId, string fileName)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(Png);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        content.Add(file, "file", fileName);
        return client.PostAsync($"/api/companies/{companyId}/logo", content);
    }

    [Fact]
    public async Task Desktop_LogoUpload_WritesUnderDataDirectory_AndIsServed()
    {
        var (client, companyId) = await SignedInWithCompany();

        var response = await UploadLogo(client, companyId, "brand.png");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var company = (await response.Content.ReadFromJsonAsync<CompanyResponse>())!;
        Assert.Equal($"/uploads/companies/{companyId}/logo.png", company.LogoUrl);
        var onDisk = Path.Combine(_dataDir, "uploads", "companies", companyId.ToString(), "logo.png");
        Assert.Equal(Png, await File.ReadAllBytesAsync(onDisk));

        var served = await client.GetAsync(company.LogoUrl);
        Assert.Equal(HttpStatusCode.OK, served.StatusCode);
        Assert.Equal("image/png", served.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await served.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task Desktop_Uploads_Return403_WithoutLaunchCookie()
    {
        var dir = Path.Combine(_dataDir, "uploads", "companies", "x");
        Directory.CreateDirectory(dir);
        await File.WriteAllBytesAsync(Path.Combine(dir, "logo.png"), Png);

        var withoutCookie = await Client(_desktop, withCookie: false).GetAsync("/uploads/companies/x/logo.png");
        var withCookie = await Client(_desktop).GetAsync("/uploads/companies/x/logo.png");

        Assert.Equal(HttpStatusCode.Forbidden, withoutCookie.StatusCode);
        Assert.Equal(HttpStatusCode.OK, withCookie.StatusCode);
    }

    [Theory]
    [InlineData("logo.png:evil")]
    [InlineData("a.png\\..\\..\\..\\evil")]
    [InlineData("a.p/../../g")]
    [InlineData("logo.png ")]
    public async Task Upload_RejectsUnsafeFileName(string fileName)
    {
        var (client, companyId) = await SignedInWithCompany();

        var response = await UploadLogo(client, companyId, fileName);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var companyDir = Path.Combine(_dataDir, "uploads", "companies", companyId.ToString());
        Assert.True(!Directory.Exists(companyDir) || Directory.GetFileSystemEntries(companyDir).Length == 0);
        Assert.Equal(new[] { "uploads" }, Directory.GetFileSystemEntries(_dataDir).Select(Path.GetFileName).ToArray());
    }

    [Fact]
    public async Task Hosted_DoesNotServeFromDataDirectory()
    {
        var dir = Path.Combine(_dataDir, "uploads", "companies", "x");
        Directory.CreateDirectory(dir);
        await File.WriteAllBytesAsync(Path.Combine(dir, "logo.png"), Png);

        var response = await Client(_hosted, withCookie: false).GetAsync("/uploads/companies/x/logo.png");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public void UploadStorage_Hosted_KeepsWwwrootUploads()
    {
        var hosted = UploadStorage.From(new DesktopOptions { Enabled = false, DataDirectory = _dataDir });
        var desktopWithoutDir = UploadStorage.From(new DesktopOptions { Enabled = true });

        Assert.Equal(Path.Combine("wwwroot", "uploads"), hosted.Root);
        Assert.Equal(Path.Combine("wwwroot", "uploads"), desktopWithoutDir.Root);
    }

    [Fact]
    public void UploadStorage_Desktop_UsesDataDirectoryUploads()
    {
        var storage = UploadStorage.From(new DesktopOptions { Enabled = true, DataDirectory = _dataDir });

        Assert.Equal(Path.Combine(Path.GetFullPath(_dataDir), "uploads"), storage.Root);
    }
}
