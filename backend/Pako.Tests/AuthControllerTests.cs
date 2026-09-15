using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pako.Api;
using Pako.Api.Auth;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

// IAsyncLifetime: xUnit creates a fresh instance of this class per [Fact] and calls DisposeAsync
// after it finishes, which is what actually closes each test's dedicated Postgres connection —
// without it, connections pile up across the run and Postgres refuses new ones past max_connections.
public class AuthControllerTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _dbContexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _dbContexts) await db.DisposeAsync();
    }

    private async Task<(PakoDbContext Db, UserManager<AppUser> UserManager)> NewContextAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _dbContexts.Add(db);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(db);
        services.AddIdentityCore<AppUser>().AddEntityFrameworkStores<PakoDbContext>();
        var userManager = services.BuildServiceProvider().GetRequiredService<UserManager<AppUser>>();
        return (db, userManager);
    }

    private static IJwtTokenService NewTokenService() => new JwtTokenService(new JwtOptions
    {
        Key = "test-only-signing-key-not-for-production-32chars+",
        Issuer = "Pako",
        Audience = "Pako"
    });

    [Fact]
    public async Task Register_DuplicateEmail_DoesNotRevealEmailWasTaken()
    {
        var (_, userManager) = await NewContextAsync();
        var controller = new AuthController(userManager, NewTokenService(), new NullStringLocalizer<ErrorMessages>());

        var first = await controller.Register(new RegisterRequest("dup@example.com", "Passw0rd!123"));
        Assert.IsType<OkObjectResult>(first.Result);

        var second = await controller.Register(new RegisterRequest("dup@example.com", "Passw0rd!123"));
        var badRequest = Assert.IsType<BadRequestObjectResult>(second.Result);
        var message = badRequest.Value!.ToString();

        Assert.DoesNotContain("taken", message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DuplicateUserName", message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Register_WeakPassword_ReturnsSpecificReasonNotGenericMessage()
    {
        // Password strength rules aren't secret information the way "this email is taken" is -
        // hiding them behind the same generic message just breaks registration for anyone who
        // trips a real, fixable validation rule (a very real bug this test used to enshrine).
        var (_, userManager) = await NewContextAsync();
        var controller = new AuthController(userManager, NewTokenService(), new NullStringLocalizer<ErrorMessages>());

        var result = await controller.Register(new RegisterRequest("weak@example.com", "abc"));
        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var message = badRequest.Value!.ToString();

        Assert.NotEqual("Registration failed. Check your details and try again.", message);
        Assert.Contains("password", message, StringComparison.OrdinalIgnoreCase);
    }
}
