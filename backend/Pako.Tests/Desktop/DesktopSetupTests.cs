using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
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
using Pako.Infrastructure.Identity;

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

    private WebApplicationFactory<Program> Build(bool enabled, bool failRecoveryRecord = false, string? appBaseUrl = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("ConnectionStrings:Default", _db.Database.GetConnectionString()!);
            b.UseSetting("Jwt:Key", new string('k', 48));
            b.UseSetting("Desktop:Enabled", enabled ? "true" : "false");
            b.UseSetting("Desktop:LaunchSecret", Secret);
            if (appBaseUrl is not null) b.UseSetting("Email:AppBaseUrl", appBaseUrl);
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

    private const string RegeneratePath = "/api/desktop/recovery-code/regenerate";
    private static readonly Regex CodeFormat = new("^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$");

    private async Task<string> Token(string email, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AuthResponse>())!.Token;
    }

    private async Task<HttpResponseMessage> Regenerate(string currentPassword, string? token = null)
    {
        token ??= await Token(Email, Password);
        using var request = new HttpRequestMessage(HttpMethod.Post, RegeneratePath)
        {
            Content = JsonContent.Create(new RegenerateRecoveryCodeRequest(currentPassword)),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await _client.SendAsync(request);
    }

    private static async Task<string> CodeOf(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var code = (await response.Content.ReadFromJsonAsync<RecoverAdminResponse>())!.RecoveryCode;
        Assert.Matches(CodeFormat, code);
        return code;
    }

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

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Login(NewPassword)).StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, (await Login(Password)).StatusCode);
        Assert.Equal(1, await _db.Set<AdminRecoveryRecord>().CountAsync(r => r.UsedAt == null));
    }

    [Fact]
    public async Task Recover_RevokesRefreshTokensIssuedBefore()
    {
        var code = await Setup();
        var login = await Login(Password);
        var refresh = (await login.Content.ReadFromJsonAsync<AuthResponse>())!.RefreshToken!;

        Assert.Equal(HttpStatusCode.OK, (await Recover(code)).StatusCode);

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

        Assert.Equal(HttpStatusCode.OK, (await Recover(code)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await Login(NewPassword)).StatusCode);
    }

    [Fact]
    public async Task Recover_RejectsWeakNewPassword_AndKeepsCodeUsable()
    {
        var code = await Setup();

        var weak = await Recover(code, "weak");

        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Recover(code)).StatusCode);
    }

    [Fact]
    public async Task Recover_CodeIsSingleUse()
    {
        var code = await Setup();
        Assert.Equal(HttpStatusCode.OK, (await Recover(code)).StatusCode);

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
        Assert.Equal(HttpStatusCode.OK, (await Recover(code)).StatusCode);
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
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync(RegeneratePath, new RegenerateRecoveryCodeRequest(Password))).StatusCode);
    }

    [Fact]
    public async Task Recover_ReturnsANewCode_AndTheOldOneNoLongerWorks()
    {
        var first = await Setup();

        var second = await CodeOf(await Recover(first));

        Assert.NotEqual(first, second);
        Assert.Equal(HttpStatusCode.BadRequest, (await Recover(first, "Third1!password")).StatusCode);
        await CodeOf(await Recover(second, "Third1!password"));
        Assert.Equal(HttpStatusCode.OK, (await Login("Third1!password")).StatusCode);
    }

    [Fact]
    public async Task Recover_WeakPassword_DoesNotIssueANewCode()
    {
        var code = await Setup();

        Assert.Equal(HttpStatusCode.BadRequest, (await Recover(code, "weak")).StatusCode);

        var records = await _db.Set<AdminRecoveryRecord>().AsNoTracking().ToListAsync();
        Assert.Single(records);
        Assert.Null(records[0].UsedAt);
    }

    [Fact]
    public async Task Regenerate_ReturnsANewCode_AndInvalidatesAllEarlierCodes()
    {
        var setupCode = await Setup();

        var second = await CodeOf(await Regenerate(Password));
        var third = await CodeOf(await Regenerate(Password));

        Assert.Equal(HttpStatusCode.BadRequest, (await Recover(setupCode)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Recover(second)).StatusCode);
        await CodeOf(await Recover(third));
        Assert.Equal(HttpStatusCode.OK, (await Login(NewPassword)).StatusCode);
    }

    [Fact]
    public async Task Regenerate_WrongPassword_Returns400_AndSharesTheRecoverThrottle()
    {
        await Setup();
        var token = await Token(Email, Password);

        var wrong = await Regenerate("Wrong1!password", token);
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        var body = await wrong.Content.ReadAsStringAsync();

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.BadRequest, (await Regenerate("Wrong1!password", token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Recover(WrongCode)).StatusCode);

        var locked = await Regenerate(Password, token);
        Assert.Equal(HttpStatusCode.BadRequest, locked.StatusCode);
        Assert.Equal(body, await locked.Content.ReadAsStringAsync());
        Assert.Equal(1, await _db.Set<AdminRecoveryRecord>().CountAsync());

        _clock.Now = _clock.Now.AddMinutes(16);
        await CodeOf(await Regenerate(Password, await Token(Email, Password)));
    }

    [Fact]
    public async Task Regenerate_Forbidden_ForANonAdministrator()
    {
        await Setup();
        using (var scope = _factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var created = await users.CreateAsync(new AppUser { UserName = "clerk@x.test", Email = "clerk@x.test", EmailConfirmed = true }, Password);
            Assert.True(created.Succeeded);
        }

        var response = await Regenerate(Password, await Token("clerk@x.test", Password));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(1, await _db.Set<AdminRecoveryRecord>().CountAsync());
    }

    [Fact]
    public async Task Regenerate_RequiresASignedInUser()
    {
        await Setup();

        var response = await _client.PostAsJsonAsync(RegeneratePath, new RegenerateRecoveryCodeRequest(Password));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task NewCodes_AreNeverStoredInPlaintext()
    {
        var setupCode = await Setup();
        var recovered = await CodeOf(await Recover(setupCode));
        var regenerated = await CodeOf(await Regenerate(NewPassword, await Token(Email, NewPassword)));

        var hashes = await _db.Set<AdminRecoveryRecord>().AsNoTracking().Select(r => r.CodeHash).ToListAsync();
        Assert.Equal(3, hashes.Count);
        foreach (var code in new[] { recovered, regenerated })
        {
            Assert.All(hashes, h => Assert.DoesNotContain(code.Replace("-", ""), h));
            Assert.All(hashes, h => Assert.DoesNotContain(code, h));
            Assert.Single(hashes, h => RecoveryCode.Verify(code, h));
        }
    }

    [Fact]
    public async Task SetupRecoverAndRegenerate_StayReachable_InLicenseReadOnlyMode()
    {
        _db.DesktopLicenseRecords.Add(DesktopLicenseRecord.Start(_clock.Now.AddDays(-(LicenseState.TrialDays + 1))));
        await _db.SaveChangesAsync();

        var code = await Setup();
        var token = await Token(Email, Password);
        using (var get = new HttpRequestMessage(HttpMethod.Get, "/api/desktop/license"))
        {
            get.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var license = await (await _client.SendAsync(get)).Content.ReadFromJsonAsync<DesktopLicenseResponse>();
            Assert.Equal("ReadOnly", license!.Status);
        }
        using (var blocked = new HttpRequestMessage(HttpMethod.Post, $"/api/companies/{Guid.NewGuid()}/invoices") { Content = JsonContent.Create(new { }) })
        {
            blocked.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            Assert.Equal(HttpStatusCode.Forbidden, (await _client.SendAsync(blocked)).StatusCode);
        }

        var fresh = await CodeOf(await Regenerate(Password, token));
        Assert.Equal(HttpStatusCode.BadRequest, (await Recover(code)).StatusCode);
        await CodeOf(await Recover(fresh));
    }

    [Fact]
    public async Task ResetLink_UsesTheWindowOrigin_PassedByTheDesktopShell()
    {
        using var desktop = Build(true, appBaseUrl: "http://127.0.0.1:6123");
        using var client = Client(desktop);
        (await client.PostAsJsonAsync("/api/desktop/setup", new DesktopSetupRequest(Email, Password, "Owner"))).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/auth/forgot-password", new ForgotPasswordRequest(Email))).StatusCode);

        var payload = await _db.Notifications.AsNoTracking().Select(n => n.PayloadJson).SingleAsync();
        var link = System.Text.Json.JsonDocument.Parse(payload).RootElement.GetProperty("link").GetString()!;
        Assert.StartsWith("http://127.0.0.1:6123/reset-password?email=", link);
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
