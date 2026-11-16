using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pako.Api.Contracts;
using Pako.Api.Desktop;
using Pako.Domain.Desktop;
using Pako.Infrastructure;
using Pako.Infrastructure.Desktop;

namespace Pako.Tests.Desktop;

public sealed class DesktopSetupTests : IAsyncLifetime
{
    private const string Secret = "s3cret";
    private const string Email = "owner@x.test";
    private const string Password = "Passw0rd!123";
    private const string NewPassword = "Another1!pass";
    private const string WrongCode = "AAAA-AAAA-AAAA-AAAA-AAAA";

    private sealed class SettableClock(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private readonly SettableClock _clock = new(new DateTimeOffset(2026, 11, 1, 9, 0, 0, TimeSpan.Zero));
    private PakoDbContext _db = null!;
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _db = await PostgresTestDatabase.CreateAsync();
        _factory = Build(true);
        _client = Client(_factory);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        _factory.Dispose();
        await _db.DisposeAsync();
    }

    private sealed class FailRecoveryRecordSave : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<AdminRecoveryRecord>().Any(e => e.State == EntityState.Added))
                throw new InvalidOperationException("simulated recovery record failure");
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private WebApplicationFactory<Program> Build(bool enabled, bool failRecoveryRecord = false) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("ConnectionStrings:Default", _db.Database.GetConnectionString()!);
            b.UseSetting("Jwt:Key", new string('k', 48));
            b.UseSetting("Desktop:Enabled", enabled ? "true" : "false");
            b.UseSetting("Desktop:LaunchSecret", Secret);
            b.ConfigureServices(s =>
            {
                s.RemoveAll<TimeProvider>();
                s.AddSingleton<TimeProvider>(_clock);
                if (failRecoveryRecord) s.ConfigureDbContext<PakoDbContext>(o => o.AddInterceptors(new FailRecoveryRecordSave()));
            });
        });

    private static HttpClient Client(WebApplicationFactory<Program> f)
    {
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        c.DefaultRequestHeaders.Add("Cookie", $"{LaunchSecretMiddleware.CookieName}={Secret}");
        return c;
    }

    private async Task<string> Setup()
    {
        var response = await _client.PostAsJsonAsync("/api/desktop/setup", new DesktopSetupRequest(Email, Password, "Owner"));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<DesktopSetupResponse>())!.RecoveryCode;
    }

    private Task<HttpResponseMessage> Recover(string code, string password = NewPassword) =>
        _client.PostAsJsonAsync("/api/desktop/recover", new RecoverAdminRequest(Email, code, password));

    private Task<HttpResponseMessage> Login(string password) =>
        _client.PostAsJsonAsync("/api/auth/login", new LoginRequest(Email, password));

    [Fact]
    public async Task Setup_CreatesFirstAdmin_ReturnsCodeOnce()
    {
        var before = await _client.GetFromJsonAsync<DesktopSetupStatusResponse>("/api/desktop/setup");
        Assert.True(before!.NeedsSetup);

        var code = await Setup();

        Assert.Matches(new Regex("^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$"), code);
        var after = await _client.GetFromJsonAsync<DesktopSetupStatusResponse>("/api/desktop/setup");
        Assert.False(after!.NeedsSetup);
        var user = await _db.Users.AsNoTracking().SingleAsync();
        Assert.True(user.IsPlatformAdmin);
        Assert.Null(user.CompanyLimit);
        Assert.Equal(HttpStatusCode.OK, (await Login(Password)).StatusCode);
    }

    [Fact]
    public async Task Setup_Returns409_AfterFirstUser()
    {
        await Setup();

        var again = await _client.PostAsJsonAsync("/api/desktop/setup", new DesktopSetupRequest("other@x.test", Password, "Other"));

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal(1, await _db.Users.CountAsync());
    }

    [Fact]
    public async Task Setup_RejectsWeakPassword()
    {
        var response = await _client.PostAsJsonAsync("/api/desktop/setup", new DesktopSetupRequest(Email, "short1!A", "Owner"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await _db.Users.CountAsync());
        Assert.True((await _client.GetFromJsonAsync<DesktopSetupStatusResponse>("/api/desktop/setup"))!.NeedsSetup);
    }

    [Fact]
    public async Task Recover_WithCorrectCode_SetsNewPassword()
    {
        var code = await Setup();

        var response = await Recover(code.ToLowerInvariant().Replace("-", " "));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(NewPassword)).StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, (await Login(Password)).StatusCode);
        Assert.Equal(1, await _db.Set<AdminRecoveryRecord>().CountAsync());
    }

    [Fact]
    public async Task Recover_RevokesRefreshTokensIssuedBefore()
    {
        var code = await Setup();
        var login = await Login(Password);
        var refresh = (await login.Content.ReadFromJsonAsync<AuthResponse>())!.RefreshToken!;

        Assert.Equal(HttpStatusCode.NoContent, (await Recover(code)).StatusCode);

        var rotated = await _client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(refresh));
        Assert.Equal(HttpStatusCode.Unauthorized, rotated.StatusCode);
    }

    [Fact]
    public async Task Setup_IsAtomic_WhenRecoveryRecordSaveFails()
    {
        using var failing = Build(true, failRecoveryRecord: true);
        using var failingClient = Client(failing);

        var response = await failingClient.PostAsJsonAsync("/api/desktop/setup", new DesktopSetupRequest(Email, Password, "Owner"));

        Assert.False(response.IsSuccessStatusCode);
        Assert.Equal(0, await _db.Users.CountAsync());
        Assert.True((await _client.GetFromJsonAsync<DesktopSetupStatusResponse>("/api/desktop/setup"))!.NeedsSetup);
        Assert.False(string.IsNullOrEmpty(await Setup()));
    }

    [Fact]
    public async Task Recover_ClearsExistingIdentityLockout()
    {
        var code = await Setup();
        for (var i = 0; i < 5; i++) await Login("Wrong1!password");
        Assert.NotEqual(HttpStatusCode.OK, (await Login(Password)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await Recover(code)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await Login(NewPassword)).StatusCode);
    }

    [Fact]
    public async Task Recover_RejectsWeakNewPassword_AndKeepsCodeUsable()
    {
        var code = await Setup();

        var weak = await Recover(code, "weak");

        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Recover(code)).StatusCode);
    }

    [Fact]
    public async Task Recover_CodeIsSingleUse()
    {
        var code = await Setup();
        Assert.Equal(HttpStatusCode.NoContent, (await Recover(code)).StatusCode);

        var again = await Recover(code, "Third1!password");

        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(NewPassword)).StatusCode);
    }

    [Fact]
    public async Task Recover_WrongCode_Returns400_AndLocksAfterFive()
    {
        var code = await Setup();

        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.BadRequest, (await Recover(WrongCode)).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await Recover(code)).StatusCode);

        _clock.Now = _clock.Now.AddMinutes(14);
        Assert.Equal(HttpStatusCode.BadRequest, (await Recover(code)).StatusCode);

        _clock.Now = _clock.Now.AddMinutes(2);
        Assert.Equal(HttpStatusCode.NoContent, (await Recover(code)).StatusCode);
    }

    [Fact]
    public async Task Recover_UnknownEmail_LooksLikeWrongCode()
    {
        var code = await Setup();

        var unknown = await _client.PostAsJsonAsync("/api/desktop/recover", new RecoverAdminRequest("nobody@x.test", code, NewPassword));
        var wrong = await Recover(WrongCode);

        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Equal(await wrong.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task RecoveryCode_NeverStoredInPlaintext()
    {
        var code = await Setup();

        var record = await _db.Set<AdminRecoveryRecord>().AsNoTracking().SingleAsync();

        Assert.DoesNotContain(code.Replace("-", ""), record.CodeHash);
        Assert.DoesNotContain(code, record.CodeHash);
        Assert.True(RecoveryCode.Verify(code, record.CodeHash));
    }

    [Fact]
    public async Task Endpoints_Absent_WhenDesktopDisabled()
    {
        using var hosted = Build(false);
        using var client = Client(hosted);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/desktop/setup")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync("/api/desktop/setup", new DesktopSetupRequest(Email, Password, "Owner"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync("/api/desktop/recover", new RecoverAdminRequest(Email, "x", NewPassword))).StatusCode);
    }

    [Fact]
    public void RecoveryCode_Generate_IsGroupedBase32_AndUnique()
    {
        var a = RecoveryCode.Generate();
        var b = RecoveryCode.Generate();

        Assert.Matches(new Regex("^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$"), a);
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void RecoveryCode_HashIsSalted_VerifyIgnoresCaseDashesSpaces()
    {
        var code = RecoveryCode.Generate();
        var h1 = RecoveryCode.Hash(code);
        var h2 = RecoveryCode.Hash(code);

        Assert.NotEqual(h1, h2);
        Assert.True(RecoveryCode.Verify(code.ToLowerInvariant().Replace("-", " "), h1));
        Assert.True(RecoveryCode.Verify(code.Replace("-", ""), h2));
        Assert.False(RecoveryCode.Verify(WrongCode, h1));
        Assert.False(RecoveryCode.Verify(code, "garbage"));
    }
}
