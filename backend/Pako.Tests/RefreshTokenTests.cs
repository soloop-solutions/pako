using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Pako.Api;
using Pako.Api.Auth;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

public class RefreshTokenTests : IAsyncLifetime
{
    private const string Password = "Passw0rd!123";
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private static readonly JwtOptions Options = new()
    {
        Key = "test-only-signing-key-not-for-production-32chars+",
        Issuer = "Pako",
        Audience = "Pako",
        RefreshTokenDays = 30,
        RefreshReuseGraceSeconds = 30
    };

    private async Task<(PakoDbContext Db, UserManager<AppUser> Users, AuthController Controller, RefreshTokenService Tokens)> NewAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(db);
        services.AddIdentityCore<AppUser>().AddEntityFrameworkStores<PakoDbContext>();
        var users = services.BuildServiceProvider().GetRequiredService<UserManager<AppUser>>();
        var tokens = new RefreshTokenService(db, Options);
        var controller = new AuthController(users, new JwtTokenService(Options), new NullStringLocalizer<ErrorMessages>(),
            new Pako.Api.Services.ActionTokenService(), NullLogger<AuthController>.Instance, null, tokens);
        return (db, users, controller, tokens);
    }

    private static async Task<AuthResponse> RegisterAsync(AuthController controller, string email = "r@example.com")
    {
        var result = await controller.Register(new RegisterRequest(email, Password));
        return Assert.IsType<AuthResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
    }

    [Fact]
    public async Task Login_ReturnsRefreshToken_StoredOnlyHashed()
    {
        var (db, _, controller, _) = await NewAsync();
        var auth = await RegisterAsync(controller);

        Assert.False(string.IsNullOrEmpty(auth.RefreshToken));
        var stored = await db.RefreshTokens.SingleAsync();
        Assert.NotEqual(auth.RefreshToken, stored.TokenHash);
        Assert.Equal(64, stored.TokenHash.Length);
    }

    [Fact]
    public async Task Refresh_RotatesToken_AndIssuesNewAccessToken()
    {
        var (db, _, controller, _) = await NewAsync();
        var auth = await RegisterAsync(controller);

        var result = await controller.Refresh(new RefreshRequest(auth.RefreshToken!));
        var next = Assert.IsType<AuthResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.NotEqual(auth.RefreshToken, next.RefreshToken);
        Assert.False(string.IsNullOrEmpty(next.Token));
        Assert.Equal(auth.UserId, next.UserId);
        Assert.Equal(2, await db.RefreshTokens.CountAsync());
    }

    [Fact]
    public async Task Refresh_UnknownToken_Unauthorized()
    {
        var (_, _, controller, _) = await NewAsync();
        var result = await controller.Refresh(new RefreshRequest("nope"));
        Assert.IsType<UnauthorizedResult>(result.Result);
    }

    [Fact]
    public async Task Refresh_ExpiredToken_Unauthorized()
    {
        var (db, _, controller, _) = await NewAsync();
        var auth = await RegisterAsync(controller);
        var stored = await db.RefreshTokens.SingleAsync();
        stored.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();

        Assert.IsType<UnauthorizedResult>((await controller.Refresh(new RefreshRequest(auth.RefreshToken!))).Result);
    }

    [Fact]
    public async Task Refresh_ReuseOutsideGrace_RevokesTheWholeFamily()
    {
        var (db, _, controller, _) = await NewAsync();
        var auth = await RegisterAsync(controller);
        var next = Assert.IsType<AuthResponse>(Assert.IsType<OkObjectResult>((await controller.Refresh(new RefreshRequest(auth.RefreshToken!))).Result).Value);

        var original = await db.RefreshTokens.OrderBy(t => t.CreatedAt).FirstAsync();
        original.UsedAt = DateTime.UtcNow.AddMinutes(-5);
        await db.SaveChangesAsync();

        Assert.IsType<UnauthorizedResult>((await controller.Refresh(new RefreshRequest(auth.RefreshToken!))).Result);
        Assert.IsType<UnauthorizedResult>((await controller.Refresh(new RefreshRequest(next.RefreshToken!))).Result);
        Assert.All(await db.RefreshTokens.AsNoTracking().ToListAsync(), t => Assert.NotNull(t.RevokedAt));
    }

    [Fact]
    public async Task Refresh_ReuseInsideGrace_StillSucceeds_ForConcurrentTabs()
    {
        var (_, _, controller, _) = await NewAsync();
        var auth = await RegisterAsync(controller);

        Assert.IsType<OkObjectResult>((await controller.Refresh(new RefreshRequest(auth.RefreshToken!))).Result);
        Assert.IsType<OkObjectResult>((await controller.Refresh(new RefreshRequest(auth.RefreshToken!))).Result);
    }

    [Fact]
    public async Task Logout_RevokesTheToken()
    {
        var (_, _, controller, _) = await NewAsync();
        var auth = await RegisterAsync(controller);

        Assert.IsType<NoContentResult>(await controller.Logout(new LogoutRequest(auth.RefreshToken)));
        Assert.IsType<UnauthorizedResult>((await controller.Refresh(new RefreshRequest(auth.RefreshToken!))).Result);
    }

    [Fact]
    public async Task Refresh_DisabledUser_UnauthorizedAndRevoked()
    {
        var (db, users, controller, _) = await NewAsync();
        var auth = await RegisterAsync(controller);
        var user = await users.FindByIdAsync(auth.UserId.ToString());
        user!.IsDisabled = true;
        await users.UpdateAsync(user);

        Assert.IsType<UnauthorizedResult>((await controller.Refresh(new RefreshRequest(auth.RefreshToken!))).Result);
        Assert.All(await db.RefreshTokens.AsNoTracking().ToListAsync(), t => Assert.NotNull(t.RevokedAt));
    }
}
