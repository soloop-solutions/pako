using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pako.Api;
using Pako.Api.Auth;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;
using Pako.Domain.Platform;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

// docs/PLATFORM_ADMIN.md on real Postgres: account requests instead of self-registration, company
// limits, per-company modules, disabling accounts, and the usage overview.
public class PlatformAdminTests : IAsyncLifetime
{
    private const string Password = "Str0ng-Passw0rd!";
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, UserManager<AppUser> Users, PlatformAdminService Platform, AppUser Admin);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(db);
        services.AddDataProtection();
        services.AddIdentityCore<AppUser>(o => o.User.RequireUniqueEmail = true)
            .AddEntityFrameworkStores<PakoDbContext>().AddDefaultTokenProviders();
        var users = services.BuildServiceProvider().GetRequiredService<UserManager<AppUser>>();

        var admin = new AppUser { Id = Guid.NewGuid(), Email = "root@pako.test", UserName = "root@pako.test", IsPlatformAdmin = true, CompanyLimit = null };
        await users.CreateAsync(admin, Password);
        var userAdmin = new UserAdminService(db, users, new NotificationOutbox(db),
            Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" }), new NullStringLocalizer<ErrorMessages>());
        var platform = new PlatformAdminService(db, users, userAdmin, new NullStringLocalizer<ErrorMessages>(), NullLogger<PlatformAdminService>.Instance);
        return new Seed(db, users, platform, admin);
    }

    private static T As<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
            }
        };
        return controller;
    }

    private static AccountRequestRequest Request(string email) =>
        new("Ardita Krasniqi", email, "+383 44 000 000", "Krasniqi Accounting", "811111111", "Prishtinë", 3, "Five clients to move over.");

    [Fact]
    public async Task AccountRequest_ApprovedWithALimit_CreatesALoginWithoutPassword_AndASetPasswordLink()
    {
        var seed = await SeedAsync();
        Assert.Null(await seed.Platform.SubmitRequestAsync(Request("ardita@firm.test")));
        // Asking again, or for an email that already has an account, silently adds nothing.
        Assert.Null(await seed.Platform.SubmitRequestAsync(Request("ARDITA@firm.test")));
        Assert.Null(await seed.Platform.SubmitRequestAsync(Request("root@pako.test")));
        Assert.NotNull(await seed.Platform.SubmitRequestAsync(Request("not-an-email")));

        var pending = Assert.Single((await seed.Platform.ListRequestsAsync(AccountRequestStatus.Pending, null, 1, 50)).Items);
        Assert.Equal(3, pending.RequestedCompanies);

        var (approved, error) = await seed.Platform.ApproveAsync(pending.Id, new ApproveAccountRequestRequest(2, "Welcome"), seed.Admin.Id);
        Assert.Null(error);
        Assert.Contains("/reset-password?email=ardita%40firm.test&token=", approved!.SetPasswordUrl);
        Assert.Equal("Approved", approved.Request.Status);
        Assert.Equal("root@pako.test", approved.Request.DecidedBy);

        var user = await seed.Users.FindByEmailAsync("ardita@firm.test");
        Assert.Equal(2, user!.CompanyLimit);
        Assert.Equal("Ardita Krasniqi", user.FullName);
        Assert.False(await seed.Users.HasPasswordAsync(user));

        var (_, again) = await seed.Platform.ApproveAsync(pending.Id, new ApproveAccountRequestRequest(2, null), seed.Admin.Id);
        Assert.NotNull(again);
    }

    [Fact]
    public async Task CompanyLimit_StopsTheNextCompany_ButNotAPlatformAdministrator()
    {
        var seed = await SeedAsync();
        var accountant = new AppUser { Id = Guid.NewGuid(), Email = "acc@firm.test", UserName = "acc@firm.test", CompanyLimit = 1 };
        await seed.Users.CreateAsync(accountant, Password);

        var controller = As(new CompaniesController(seed.Db, new NullStringLocalizer<ErrorMessages>()), accountant.Id);
        var first = await controller.Create(new CreateCompanyRequest("First Co"));
        Assert.Equal(StatusCodes.Status201Created, Assert.IsAssignableFrom<ObjectResult>(first.Result).StatusCode);
        var second = await controller.Create(new CreateCompanyRequest("Second Co"));
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(second.Result).StatusCode);

        var me = await seed.Platform.MyAccountAsync(accountant.Id);
        Assert.Equal(1, me!.CompaniesCreated);
        Assert.Equal(1, me.CompanyLimit);

        var asAdmin = As(new CompaniesController(seed.Db, new NullStringLocalizer<ErrorMessages>()), seed.Admin.Id);
        Assert.Equal(StatusCodes.Status201Created, Assert.IsAssignableFrom<ObjectResult>((await asAdmin.Create(new CreateCompanyRequest("Admin Co 1"))).Result).StatusCode);
        Assert.Equal(StatusCodes.Status201Created, Assert.IsAssignableFrom<ObjectResult>((await asAdmin.Create(new CreateCompanyRequest("Admin Co 2"))).Result).StatusCode);

        // Raising the limit lets the accountant continue.
        Assert.Null(await seed.Platform.UpdateUserAsync(accountant.Id, new UpdatePlatformUserRequest(3, false, false), seed.Admin.Id));
        Assert.Equal(StatusCodes.Status201Created, Assert.IsAssignableFrom<ObjectResult>((await controller.Create(new CreateCompanyRequest("Second Co"))).Result).StatusCode);
    }

    [Fact]
    public async Task DisabledModule_IsRefusedAndReadsAsNoAccess_OtherModulesUnaffected()
    {
        var seed = await SeedAsync();
        var owner = new AppUser { Id = Guid.NewGuid(), Email = "owner@co.test", UserName = "owner@co.test" };
        await seed.Users.CreateAsync(owner, Password);
        var company = new Company { Id = Guid.NewGuid(), Name = "No HR Co", CreatedByUserId = owner.Id };
        seed.Db.Companies.Add(company);
        seed.Db.Memberships.Add(Membership.ForCompany(owner.Id, company.Id, MembershipRole.ClientAdmin));
        seed.Db.Employees.Add(new Employee { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Owner", UserId = owner.Id });
        await seed.Db.SaveChangesAsync();

        // Payroll can't be on without HR.
        var (_, error) = await seed.Platform.UpdateModulesAsync(company.Id, new List<string> { "sales", "payroll" }, seed.Admin.Id);
        Assert.NotNull(error);
        var (updated, ok) = await seed.Platform.UpdateModulesAsync(company.Id, new List<string> { "sales", "purchases", "accounting", "reports" }, seed.Admin.Id);
        Assert.Null(ok);
        Assert.Equal(new[] { "sales", "purchases", "accounting", "reports" }, updated!.Modules);

        var (hr, _) = await FilterAsync(seed.Db, owner.Id, company.Id, AccessModule.Hr);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(hr).StatusCode);
        var (self, _) = await FilterAsync(seed.Db, owner.Id, company.Id, AccessModule.Self);
        Assert.IsType<ObjectResult>(self);

        var (sales, access) = await FilterAsync(seed.Db, owner.Id, company.Id, AccessModule.Sales);
        Assert.Null(sales);
        Assert.Equal(AccessLevel.Approve, access.LevelFor(AccessModule.Sales));
        Assert.Equal(AccessLevel.None, access.LevelFor(AccessModule.Hr));
        Assert.Equal(AccessLevel.None, access.LevelFor(AccessModule.Payroll));

        // "My HR" disappears with the HR module.
        var (_, general) = await FilterAsync(seed.Db, owner.Id, company.Id, AccessModule.None);
        var myAccess = (MyAccessResponse)Assert.IsType<OkObjectResult>((await new MyAccessController(seed.Db, general).Get(company.Id)).Result).Value!;
        Assert.Null(myAccess.LinkedEmployeeId);
        Assert.Equal(AccessLevel.None, myAccess.Modules.Hr);
    }

    [Fact]
    public async Task DisabledAccount_IsRefusedOnTheNextRequest_AndAnAdminCantLockThemselfOut()
    {
        var seed = await SeedAsync();
        var user = new AppUser { Id = Guid.NewGuid(), Email = "gone@co.test", UserName = "gone@co.test" };
        await seed.Users.CreateAsync(user, Password);
        Assert.Null(await seed.Platform.UpdateUserAsync(user.Id, new UpdatePlatformUserRequest(0, true, false), seed.Admin.Id));

        var context = AuthorizationContext(user.Id);
        await new ActiveUserFilter(seed.Db, new NullStringLocalizer<ErrorMessages>()).OnAuthorizationAsync(context);
        Assert.Equal(StatusCodes.Status401Unauthorized, Assert.IsType<ObjectResult>(context.Result).StatusCode);

        var adminContext = AuthorizationContext(seed.Admin.Id);
        await new ActiveUserFilter(seed.Db, new NullStringLocalizer<ErrorMessages>()).OnAuthorizationAsync(adminContext);
        Assert.Null(adminContext.Result);

        Assert.NotNull(await seed.Platform.UpdateUserAsync(seed.Admin.Id, new UpdatePlatformUserRequest(null, true, true), seed.Admin.Id));
        Assert.NotNull(await seed.Platform.UpdateUserAsync(seed.Admin.Id, new UpdatePlatformUserRequest(null, false, false), seed.Admin.Id));

        // Only platform administrators get past the panel's filter.
        var userPanel = AuthorizationContext(user.Id);
        await new PlatformAdminFilter(seed.Db).OnAuthorizationAsync(userPanel);
        Assert.IsType<ForbidResult>(userPanel.Result);
        var adminPanel = AuthorizationContext(seed.Admin.Id);
        await new PlatformAdminFilter(seed.Db).OnAuthorizationAsync(adminPanel);
        Assert.Null(adminPanel.Result);
    }

    [Fact]
    public async Task Overview_SumsUsagePerAccountant()
    {
        var seed = await SeedAsync();
        var accountant = new AppUser { Id = Guid.NewGuid(), Email = "busy@firm.test", UserName = "busy@firm.test", CompanyLimit = 5 };
        var staff = new AppUser { Id = Guid.NewGuid(), Email = "staff@firm.test", UserName = "staff@firm.test" };
        await seed.Users.CreateAsync(accountant, Password);
        await seed.Users.CreateAsync(staff, Password);
        var company = new Company { Id = Guid.NewGuid(), Name = "Busy Co", CreatedByUserId = accountant.Id };
        seed.Db.Companies.Add(company);
        seed.Db.Memberships.Add(Membership.ForCompany(accountant.Id, company.Id, MembershipRole.ClientAdmin));
        seed.Db.Memberships.Add(Membership.ForCompany(staff.Id, company.Id, MembershipRole.ClientStaff));
        seed.Db.Employees.Add(new Employee { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "E1" });
        seed.Db.AccountRequests.Add(new AccountRequest { Id = Guid.NewGuid(), FullName = "X", Email = "x@y.test" });
        await seed.Db.SaveChangesAsync();

        var overview = await seed.Platform.OverviewAsync();
        Assert.Equal(1, overview.PendingRequests);
        Assert.Equal(1, overview.Companies);
        var row = Assert.Single(overview.Accountants);
        Assert.Equal("busy@firm.test", row.Email);
        Assert.Equal(1, row.CompaniesCreated);
        Assert.Equal(1, row.TeamMembers);
        Assert.Equal(1, row.Employees);
        Assert.Equal(5, row.CompanyLimit);
    }

    [Fact]
    public async Task SelfRegistration_IsOffUnlessConfigured()
    {
        var seed = await SeedAsync();
        var off = new AuthController(seed.Users, new JwtTokenService(new JwtOptions
            { Key = new string('k', 64), Issuer = "t", Audience = "t", ExpiryMinutes = 5 }),
            new NullStringLocalizer<ErrorMessages>(), new ActionTokenService(), Options.Create(new PlatformOptions()));
        var result = await off.Register(new RegisterRequest("new@x.test", Password));
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Null(await seed.Users.FindByEmailAsync("new@x.test"));
    }

    [Fact]
    public async Task Lists_ArePaged_AndEveryAdministrationChangeIsInTheAuditTrail()
    {
        var seed = await SeedAsync();
        for (var i = 0; i < 5; i++)
        {
            await seed.Users.CreateAsync(new AppUser { Id = Guid.NewGuid(), Email = $"u{i}@page.test", UserName = $"u{i}@page.test" }, Password);
        }
        var first = await seed.Platform.ListUsersAsync("page.test", 1, 2);
        Assert.Equal(5, first.Total);
        Assert.Equal(new[] { "u0@page.test", "u1@page.test" }, first.Items.Select(u => u.Email));
        Assert.Equal("u4@page.test", Assert.Single((await seed.Platform.ListUsersAsync("page.test", 3, 2)).Items).Email);

        var target = (await seed.Platform.ListUsersAsync("u1@page.test", 1, 10)).Items.Single();
        Assert.Null(await seed.Platform.UpdateUserAsync(target.Id, new UpdatePlatformUserRequest(4, true, false), seed.Admin.Id));
        var company = new Company { Id = Guid.NewGuid(), Name = "Audited Co" };
        seed.Db.Companies.Add(company);
        await seed.Db.SaveChangesAsync();
        await seed.Platform.UpdateModulesAsync(company.Id, new List<string> { "sales" }, seed.Admin.Id);

        var audit = await seed.Platform.AuditAsync(1, 50);
        Assert.Equal(2, audit.Total);
        var modules = audit.Items[0];
        Assert.Equal(("UpdateModules", "Audited Co", "root@pako.test"), (modules.Action, modules.TargetLabel, modules.ActorEmail));
        // jsonb reformats stored JSON, so read it rather than match text.
        using var moduleDetails = System.Text.Json.JsonDocument.Parse(modules.Details!);
        Assert.Equal("sales", Assert.Single(moduleDetails.RootElement.GetProperty("after").EnumerateArray()).GetString());
        var user = audit.Items[1];
        Assert.Equal(("UpdateUser", "u1@page.test"), (user.Action, user.TargetLabel));
        using var userDetails = System.Text.Json.JsonDocument.Parse(user.Details!);
        Assert.True(userDetails.RootElement.GetProperty("after").GetProperty("isDisabled").GetBoolean());
        Assert.False(userDetails.RootElement.GetProperty("before").GetProperty("isDisabled").GetBoolean());
    }

    [Fact]
    public async Task AnAdministratorFromConfiguration_CanNotBeDemotedFromThePanel()
    {
        var seed = await SeedAsync();
        var configured = new AppUser { Id = Guid.NewGuid(), Email = "boss@pako.test", UserName = "boss@pako.test", IsPlatformAdmin = true };
        await seed.Users.CreateAsync(configured, Password);
        var userAdmin = new UserAdminService(seed.Db, seed.Users, new NotificationOutbox(seed.Db),
            Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" }), new NullStringLocalizer<ErrorMessages>());
        var platform = new PlatformAdminService(seed.Db, seed.Users, userAdmin, new NullStringLocalizer<ErrorMessages>(),
            NullLogger<PlatformAdminService>.Instance, Options.Create(new PlatformOptions { AdminEmails = { "boss@pako.test" } }));

        Assert.NotNull(await platform.UpdateUserAsync(configured.Id, new UpdatePlatformUserRequest(null, false, false), seed.Admin.Id));
        Assert.True((await seed.Users.FindByIdAsync(configured.Id.ToString()))!.IsPlatformAdmin);
    }

    private static PlatformBootstrap Bootstrap(Seed seed, string? email, string? password) =>
        new(seed.Db, seed.Users,
            Options.Create(new PlatformOptions { BootstrapAdmin = new BootstrapAdminOptions { Email = email, Password = password } }),
            NullLogger<PlatformBootstrap>.Instance);

    [Fact]
    public async Task FirstRun_CreatesTheConfiguredAdministrator_OnlyWhileThereIsNone()
    {
        var seed = await SeedAsync();
        // The seed already has an administrator: nothing happens.
        Assert.Equal(PlatformBootstrap.Outcome.AlreadyHasAdministrator, await Bootstrap(seed, "test@test.com", "Test123!").RunAsync());
        Assert.Null(await seed.Users.FindByEmailAsync("test@test.com"));

        // A database without one (the seed admin demoted directly): the configured account is created.
        seed.Admin.IsPlatformAdmin = false;
        await seed.Users.UpdateAsync(seed.Admin);
        Assert.Equal(PlatformBootstrap.Outcome.Created, await Bootstrap(seed, "test@test.com", "Test123!").RunAsync());
        var created = await seed.Users.FindByEmailAsync("test@test.com");
        Assert.True(created!.IsPlatformAdmin);
        Assert.Null(created.CompanyLimit);
        Assert.True(await seed.Users.CheckPasswordAsync(created, "Test123!"));

        // Every later start: there is an administrator now.
        Assert.Equal(PlatformBootstrap.Outcome.AlreadyHasAdministrator, await Bootstrap(seed, "test@test.com", "Test123!").RunAsync());
    }

    [Fact]
    public async Task FirstRun_PromotesAnExistingAccount_WithoutTouchingItsPassword()
    {
        var seed = await SeedAsync();
        seed.Admin.IsPlatformAdmin = false;
        await seed.Users.UpdateAsync(seed.Admin);
        var existing = new AppUser { Id = Guid.NewGuid(), Email = "test@test.com", UserName = "test@test.com", CompanyLimit = 0 };
        await seed.Users.CreateAsync(existing, "Own-Passw0rd!");

        Assert.Equal(PlatformBootstrap.Outcome.Promoted, await Bootstrap(seed, "test@test.com", "Test123!").RunAsync());
        var user = await seed.Users.FindByEmailAsync("test@test.com");
        Assert.True(user!.IsPlatformAdmin);
        Assert.Null(user.CompanyLimit);
        Assert.True(await seed.Users.CheckPasswordAsync(user, "Own-Passw0rd!"));
        Assert.False(await seed.Users.CheckPasswordAsync(user, "Test123!"));
        Assert.Equal(PlatformBootstrap.Outcome.NotConfigured, await Bootstrap(seed, null, null).RunAsync());
    }

    private static AuthorizationFilterContext AuthorizationContext(Guid userId)
    {
        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
        };
        return new AuthorizationFilterContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>());
    }

    private static async Task<(IActionResult? Result, CompanyAccessContext Access)> FilterAsync(PakoDbContext db, Guid userId, Guid companyId, AccessModule module)
    {
        var services = new ServiceCollection();
        services.AddSingleton(typeof(Microsoft.Extensions.Localization.IStringLocalizer<ErrorMessages>), new NullStringLocalizer<ErrorMessages>());
        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth")),
            RequestServices = services.BuildServiceProvider()
        };
        var routeData = new RouteData();
        routeData.Values["companyId"] = companyId.ToString();
        var actionContext = new ActionContext(httpContext, routeData, new ActionDescriptor());
        var executing = new ActionExecutingContext(actionContext, new List<IFilterMetadata>(), new Dictionary<string, object?>(), new object());
        var access = new CompanyAccessContext();
        await new CompanyAccessFilter(db, access, false, false, module)
            .OnActionExecutionAsync(executing, () => Task.FromResult(new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), new object())));
        return (executing.Result, access);
    }
}
