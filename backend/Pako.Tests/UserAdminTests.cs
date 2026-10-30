using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Notifications;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

// docs/USER_ACCESS_PLAN.md on real Postgres: roles, the View/Edit/Approve levels, invitations,
// deactivation and the last-administrator guard.
public class UserAdminTests : IAsyncLifetime
{
    private const string Password = "Str0ng-Passw0rd!";
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private record Seed(PakoDbContext Db, UserManager<AppUser> Users, UserAdminService Admin, Guid CompanyId, Guid AdminUserId, Guid AdminMembershipId);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(db);
        services.AddDataProtection();
        services.AddIdentityCore<AppUser>(o => { o.Lockout.MaxFailedAccessAttempts = 5; o.User.RequireUniqueEmail = true; })
            .AddEntityFrameworkStores<PakoDbContext>().AddDefaultTokenProviders();
        var users = services.BuildServiceProvider().GetRequiredService<UserManager<AppUser>>();

        var company = new Company { Id = Guid.NewGuid(), Name = "Admin Co" };
        db.Companies.Add(company);
        var admin = new AppUser { Id = Guid.NewGuid(), Email = "admin@co.test", UserName = "admin@co.test" };
        await users.CreateAsync(admin, Password);
        var membership = Membership.ForCompany(admin.Id, company.Id, MembershipRole.ClientAdmin);
        db.Memberships.Add(membership);
        await db.SaveChangesAsync();

        var service = new UserAdminService(db, users, new NotificationOutbox(db),
            Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" }), new NullStringLocalizer<ErrorMessages>());
        return new Seed(db, users, service, company.Id, admin.Id, membership.Id);
    }

    private static async Task<(IActionResult? Result, CompanyAccessContext Access)> FilterAsync(
        PakoDbContext db, Guid userId, Guid companyId, AccessModule module, bool write = false, bool approve = false, bool adminOnly = false)
    {
        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
        };
        var routeData = new RouteData();
        routeData.Values["companyId"] = companyId.ToString();
        var actionContext = new ActionContext(httpContext, routeData, new ActionDescriptor());
        var executing = new ActionExecutingContext(actionContext, new List<IFilterMetadata>(), new Dictionary<string, object?>(), new object());
        var access = new CompanyAccessContext();
        await new CompanyAccessFilter(db, access, write, adminOnly, module, approve)
            .OnActionExecutionAsync(executing, () => Task.FromResult(new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), new object())));
        return (executing.Result, access);
    }

    private static string TokenFrom(string url) => Uri.UnescapeDataString(url[(url.IndexOf("token=", StringComparison.Ordinal) + 6)..]);

    // ---- Roles ----

    [Fact]
    public async Task BuiltInRoles_SeededOnce_AndPartnerScopedRolesNeverGetTheLedger()
    {
        var seed = await SeedAsync();
        var roles = await seed.Admin.RolesAsync(seed.CompanyId);
        Assert.Equal(CompanyRole.Templates.Count, roles.Count);
        Assert.Equal(roles.Count, (await seed.Admin.RolesAsync(seed.CompanyId)).Count);

        var accountant = roles.Single(r => r.BuiltInKey == "accountant");
        Assert.Equal(AccessLevel.Approve, accountant.Levels.Accounting);
        Assert.Equal(AccessLevel.None, accountant.Levels.Users);
        Assert.Equal(AccessLevel.None, roles.Single(r => r.BuiltInKey == "readonly").Levels.Payroll);

        var levels = accountant.Levels with { Sales = AccessLevel.Write };
        var scoped = await seed.Admin.SaveRoleAsync(seed.CompanyId, new CompanyRole(),
            new SaveCompanyRoleRequest("Field sales", null, levels, PartnerScope.Assigned), seed.AdminUserId);
        Assert.Equal(AccessLevel.None, scoped.Value!.LevelFor(AccessModule.Accounting));
    }

    // ---- Levels ----

    [Fact]
    public async Task EditCanDraftButNotPost_ApproveCanPost_NoneSeesNothing()
    {
        var seed = await SeedAsync();
        await seed.Admin.EnsureBuiltInRolesAsync(seed.CompanyId);
        var salesRole = await seed.Db.CompanyRoles.SingleAsync(r => r.CompanyId == seed.CompanyId && r.BuiltInKey == "sales");
        var clerk = Guid.NewGuid();
        var membership = Membership.ForCompany(clerk, seed.CompanyId, MembershipRole.ClientStaff);
        membership.CompanyRoleId = salesRole.Id;
        seed.Db.Memberships.Add(membership);
        await seed.Db.SaveChangesAsync();

        Assert.Null((await FilterAsync(seed.Db, clerk, seed.CompanyId, AccessModule.Sales, write: true)).Result);
        Assert.IsType<ForbidResult>((await FilterAsync(seed.Db, clerk, seed.CompanyId, AccessModule.Sales, approve: true)).Result);
        Assert.IsType<ForbidResult>((await FilterAsync(seed.Db, clerk, seed.CompanyId, AccessModule.Payroll)).Result);
        Assert.IsType<ForbidResult>((await FilterAsync(seed.Db, clerk, seed.CompanyId, AccessModule.Users, adminOnly: true)).Result);

        salesRole.SalesAccess = AccessLevel.Approve;
        await seed.Db.SaveChangesAsync();
        var (posted, access) = await FilterAsync(seed.Db, clerk, seed.CompanyId, AccessModule.Sales, approve: true);
        Assert.Null(posted);
        Assert.Equal(AccessLevel.Approve, access.LevelFor(AccessModule.Sales));
    }

    // ---- Invitations ----

    [Fact]
    public async Task Invitation_NewPerson_SetsPassword_JoinsWithTheRoleAndEmployee_LinkWorksOnce()
    {
        var seed = await SeedAsync();
        await seed.Admin.EnsureBuiltInRolesAsync(seed.CompanyId);
        var payroll = await seed.Db.CompanyRoles.SingleAsync(r => r.CompanyId == seed.CompanyId && r.BuiltInKey == "payroll");
        var employee = new Employee { Id = Guid.NewGuid(), CompanyId = seed.CompanyId, Name = "Arta Krasniqi", MonthlyGrossSalary = 1000m };
        seed.Db.Employees.Add(employee);
        await seed.Db.SaveChangesAsync();

        var invited = await seed.Admin.InviteAsync(seed.CompanyId,
            new InviteUserRequest("arta@co.test", "Arta Krasniqi", false, payroll.Id, employee.Id), seed.AdminUserId);
        Assert.NotNull(invited.Value);
        Assert.StartsWith("https://app.test/accept-invite?token=", invited.Value!.InviteUrl);
        Assert.Equal("Invited", invited.Value.User.Status);
        Assert.Equal(NotificationTemplates.UserInvitation, (await seed.Db.Notifications.AsNoTracking().SingleAsync()).Template);

        // Only the hash is stored.
        var token = TokenFrom(invited.Value.InviteUrl);
        Assert.DoesNotContain(await seed.Db.UserInvitations.AsNoTracking().Select(i => i.TokenHash).ToListAsync(), h => h == token);

        var accepted = await seed.Admin.AcceptAsync(new AcceptInvitationRequest(token, null, Password));
        Assert.NotNull(accepted.Value);
        var membership = await seed.Db.Memberships.AsNoTracking().SingleAsync(m => m.UserId == accepted.Value!.Id);
        Assert.Equal(MembershipRole.ClientStaff, membership.Role);
        Assert.Equal(payroll.Id, membership.CompanyRoleId);
        Assert.Equal(accepted.Value!.Id, (await seed.Db.Employees.AsNoTracking().SingleAsync(e => e.Id == employee.Id)).UserId);
        Assert.Equal("Arta Krasniqi", accepted.Value.FullName);

        Assert.Null((await seed.Admin.AcceptAsync(new AcceptInvitationRequest(token, null, Password))).Value);
        Assert.Null(await seed.Admin.OpenInvitationAsync(token));
    }

    [Fact]
    public async Task Invitation_ExistingAccount_NeedsItsPassword_ExpiredOrRevokedLinksFail()
    {
        var seed = await SeedAsync();
        await seed.Admin.EnsureBuiltInRolesAsync(seed.CompanyId);
        var reports = await seed.Db.CompanyRoles.SingleAsync(r => r.CompanyId == seed.CompanyId && r.BuiltInKey == "reports");
        await seed.Users.CreateAsync(new AppUser { Id = Guid.NewGuid(), Email = "elsewhere@co.test", UserName = "elsewhere@co.test" }, Password);

        var invited = (await seed.Admin.InviteAsync(seed.CompanyId, new InviteUserRequest("elsewhere@co.test", null, false, reports.Id, null), seed.AdminUserId)).Value!;
        var token = TokenFrom(invited.InviteUrl);
        Assert.Null((await seed.Admin.AcceptAsync(new AcceptInvitationRequest(token, null, "wrong-password"))).Value);
        Assert.NotNull((await seed.Admin.AcceptAsync(new AcceptInvitationRequest(token, null, Password))).Value);

        var second = (await seed.Admin.InviteAsync(seed.CompanyId, new InviteUserRequest("late@co.test", null, false, reports.Id, null), seed.AdminUserId)).Value!;
        var stored = await seed.Db.UserInvitations.SingleAsync(i => i.Email == "late@co.test");
        stored.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
        await seed.Db.SaveChangesAsync();
        Assert.Null(await seed.Admin.OpenInvitationAsync(TokenFrom(second.InviteUrl)));

        // Resending issues a new link and kills the old one.
        var resent = (await seed.Admin.ResendAsync(seed.CompanyId, stored.Id, seed.AdminUserId)).Value!;
        Assert.NotNull(await seed.Admin.OpenInvitationAsync(TokenFrom(resent.InviteUrl)));
        Assert.Null(await seed.Admin.OpenInvitationAsync(TokenFrom(second.InviteUrl)));

        Assert.Null(await seed.Admin.RevokeAsync(seed.CompanyId, stored.Id, seed.AdminUserId));
        Assert.Null(await seed.Admin.OpenInvitationAsync(TokenFrom(resent.InviteUrl)));
    }

    [Fact]
    public async Task Invite_RefusesAnExistingMember_AndAMissingRole()
    {
        var seed = await SeedAsync();
        Assert.Null((await seed.Admin.InviteAsync(seed.CompanyId, new InviteUserRequest("admin@co.test", null, true, null, null), seed.AdminUserId)).Value);
        Assert.Null((await seed.Admin.InviteAsync(seed.CompanyId, new InviteUserRequest("new@co.test", null, false, null, null), seed.AdminUserId)).Value);
    }

    // ---- Deactivation and the last administrator ----

    [Fact]
    public async Task Deactivating_BlocksTheNextRequest_ReactivatingRestoresIt()
    {
        var seed = await SeedAsync();
        await seed.Admin.EnsureBuiltInRolesAsync(seed.CompanyId);
        var reports = await seed.Db.CompanyRoles.SingleAsync(r => r.CompanyId == seed.CompanyId && r.BuiltInKey == "reports");
        var user = Guid.NewGuid();
        var membership = Membership.ForCompany(user, seed.CompanyId, MembershipRole.ClientStaff);
        membership.CompanyRoleId = reports.Id;
        seed.Db.Memberships.Add(membership);
        await seed.Db.SaveChangesAsync();
        Assert.Null((await FilterAsync(seed.Db, user, seed.CompanyId, AccessModule.Reports)).Result);

        Assert.Null(await seed.Admin.SetActiveAsync(seed.CompanyId, membership.Id, false, seed.AdminUserId));
        Assert.IsType<ForbidResult>((await FilterAsync(seed.Db, user, seed.CompanyId, AccessModule.Reports)).Result);

        Assert.Null(await seed.Admin.SetActiveAsync(seed.CompanyId, membership.Id, true, seed.AdminUserId));
        Assert.Null((await FilterAsync(seed.Db, user, seed.CompanyId, AccessModule.Reports)).Result);
    }

    [Fact]
    public async Task LastAdministrator_CanNotBeDemotedDeactivatedOrRemoved_NorCanAnAdminDeactivateThemself()
    {
        var seed = await SeedAsync();
        await seed.Admin.EnsureBuiltInRolesAsync(seed.CompanyId);
        var reports = await seed.Db.CompanyRoles.SingleAsync(r => r.CompanyId == seed.CompanyId && r.BuiltInKey == "reports");
        var other = Guid.NewGuid();

        Assert.NotNull(await seed.Admin.UpdateUserAsync(seed.CompanyId, seed.AdminMembershipId, new UpdateCompanyUserRequest(false, reports.Id, null), other));
        Assert.NotNull(await seed.Admin.SetActiveAsync(seed.CompanyId, seed.AdminMembershipId, false, other));
        Assert.NotNull(await seed.Admin.RemoveAsync(seed.CompanyId, seed.AdminMembershipId, other));
        Assert.NotNull(await seed.Admin.SetActiveAsync(seed.CompanyId, seed.AdminMembershipId, false, seed.AdminUserId));

        // With a second administrator, the first can step down.
        var second = Membership.ForCompany(other, seed.CompanyId, MembershipRole.ClientAdmin);
        seed.Db.Memberships.Add(second);
        await seed.Db.SaveChangesAsync();
        Assert.Null(await seed.Admin.UpdateUserAsync(seed.CompanyId, seed.AdminMembershipId, new UpdateCompanyUserRequest(false, reports.Id, null), other));
        Assert.Equal(MembershipRole.ClientStaff, (await seed.Db.Memberships.AsNoTracking().SingleAsync(m => m.Id == seed.AdminMembershipId)).Role);
    }

    [Fact]
    public async Task RoleInUse_CanNotBeDeleted()
    {
        var seed = await SeedAsync();
        await seed.Admin.EnsureBuiltInRolesAsync(seed.CompanyId);
        var reports = await seed.Db.CompanyRoles.SingleAsync(r => r.CompanyId == seed.CompanyId && r.BuiltInKey == "reports");
        var membership = Membership.ForCompany(Guid.NewGuid(), seed.CompanyId, MembershipRole.ClientStaff);
        membership.CompanyRoleId = reports.Id;
        seed.Db.Memberships.Add(membership);
        await seed.Db.SaveChangesAsync();

        Assert.NotNull(await seed.Admin.DeleteRoleAsync(seed.CompanyId, reports.Id, seed.AdminUserId));
        Assert.Null(await seed.Admin.RemoveAsync(seed.CompanyId, membership.Id, seed.AdminUserId));
        Assert.Null(await seed.Admin.DeleteRoleAsync(seed.CompanyId, reports.Id, seed.AdminUserId));
    }

    [Fact]
    public async Task UsersList_ShowsMembersAndPendingInvitations()
    {
        var seed = await SeedAsync();
        await seed.Admin.EnsureBuiltInRolesAsync(seed.CompanyId);
        var sales = await seed.Db.CompanyRoles.SingleAsync(r => r.CompanyId == seed.CompanyId && r.BuiltInKey == "sales");
        await seed.Admin.InviteAsync(seed.CompanyId, new InviteUserRequest("new@co.test", "New Person", false, sales.Id, null), seed.AdminUserId);

        var users = await seed.Admin.UsersAsync(seed.CompanyId, seed.AdminUserId);

        var me = users.Single(u => u.IsYou);
        Assert.Equal("Administrator", me.Access);
        var invited = users.Single(u => u.Email == "new@co.test");
        Assert.Equal("Invited", invited.Status);
        Assert.Equal(sales.Name, invited.RoleName);
    }

    // ---- Login lockout and password reset (AuthController) ----

    [Fact]
    public async Task FiveWrongPasswords_LockTheAccount_AResetUnlocksIt_ForgotPasswordNeverRevealsAccounts()
    {
        var seed = await SeedAsync();
        var auth = new Pako.Api.Controllers.AuthController(seed.Users,
            new Pako.Api.Auth.JwtTokenService(new Pako.Api.Auth.JwtOptions { Key = "test-only-signing-key-not-for-production-32chars+", Issuer = "Pako", Audience = "Pako" }),
            new NullStringLocalizer<ErrorMessages>(), new ActionTokenService());

        for (var i = 0; i < 5; i++)
        {
            Assert.IsType<UnauthorizedResult>((await auth.Login(new LoginRequest("admin@co.test", "wrong"))).Result);
        }

        var locked = await auth.Login(new LoginRequest("admin@co.test", Password));
        Assert.Equal(StatusCodes.Status423Locked, Assert.IsType<ObjectResult>(locked.Result).StatusCode);

        // Same answer for a known and an unknown address.
        Assert.IsType<NoContentResult>(await auth.ForgotPassword(new ForgotPasswordRequest("nobody@co.test"), seed.Admin, seed.Db));
        Assert.IsType<NoContentResult>(await auth.ForgotPassword(new ForgotPasswordRequest("admin@co.test"), seed.Admin, seed.Db));
        var mail = await seed.Db.Notifications.AsNoTracking().SingleAsync(n => n.Template == NotificationTemplates.PasswordReset);
        var link = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(mail.PayloadJson)!["link"];
        var token = Uri.UnescapeDataString(link[(link.IndexOf("token=", StringComparison.Ordinal) + 6)..]);

        Assert.IsType<BadRequestObjectResult>(await auth.ResetPassword(new ResetPasswordRequest("admin@co.test", "forged", "N3w-Passw0rd!")));
        Assert.IsType<NoContentResult>(await auth.ResetPassword(new ResetPasswordRequest("admin@co.test", token, "N3w-Passw0rd!")));

        var ok = Assert.IsType<OkObjectResult>((await auth.Login(new LoginRequest("admin@co.test", "N3w-Passw0rd!"))).Result);
        Assert.NotNull(ok.Value);
        Assert.NotNull((await seed.Users.FindByEmailAsync("admin@co.test"))!.LastLoginAt);
    }

    [Fact]
    public async Task StaffWithoutARole_GetsWhatTheEmployeeRoleGives_ReferenceDataOnly()
    {
        var seed = await SeedAsync();
        var user = Guid.NewGuid();
        seed.Db.Memberships.Add(Membership.ForCompany(user, seed.CompanyId, MembershipRole.ClientStaff));
        await seed.Db.SaveChangesAsync();

        Assert.Null((await FilterAsync(seed.Db, user, seed.CompanyId, AccessModule.None)).Result);
        Assert.IsType<ForbidResult>((await FilterAsync(seed.Db, user, seed.CompanyId, AccessModule.None, write: true)).Result);
        Assert.IsType<ForbidResult>((await FilterAsync(seed.Db, user, seed.CompanyId, AccessModule.Sales)).Result);
        Assert.IsType<ForbidResult>((await FilterAsync(seed.Db, user, seed.CompanyId, AccessModule.Users, adminOnly: true)).Result);
    }

    // ---- Security guards from the 2026-10-30 audit ----

    [Fact]
    public async Task PasswordResetLink_OnlyForStaffOfThisCompanyAlone_NeverAnAdminOrSomeoneWithOtherAccess()
    {
        var seed = await SeedAsync();
        async Task<Membership> Member(string email, MembershipRole role, Guid companyId)
        {
            var user = await seed.Users.FindByEmailAsync(email);
            if (user is null)
            {
                user = new AppUser { Id = Guid.NewGuid(), Email = email, UserName = email };
                await seed.Users.CreateAsync(user, Password);
            }
            var membership = Membership.ForCompany(user.Id, companyId, role);
            seed.Db.Memberships.Add(membership);
            await seed.Db.SaveChangesAsync();
            return membership;
        }
        var otherCompany = new Company { Id = Guid.NewGuid(), Name = "Other Co" };
        seed.Db.Companies.Add(otherCompany);
        await seed.Db.SaveChangesAsync();

        var staff = await Member("staff@co.test", MembershipRole.ClientStaff, seed.CompanyId);
        var shared = await Member("shared@co.test", MembershipRole.ClientStaff, seed.CompanyId);
        await Member("shared@co.test", MembershipRole.ClientStaff, otherCompany.Id);
        var admin2 = await Member("admin2@co.test", MembershipRole.ClientAdmin, seed.CompanyId);

        Assert.NotNull((await seed.Admin.PasswordResetLinkAsync(seed.CompanyId, staff.Id, seed.AdminUserId)).Value);
        Assert.Null((await seed.Admin.PasswordResetLinkAsync(seed.CompanyId, shared.Id, seed.AdminUserId)).Value);
        Assert.Null((await seed.Admin.PasswordResetLinkAsync(seed.CompanyId, admin2.Id, seed.AdminUserId)).Value);
    }

    [Fact]
    public async Task Invitation_CanNotCreateAPlatformAdminAddress_AndJoiningWithAnExistingAccountKeepsTheLockout()
    {
        var seed = await SeedAsync();
        var admin = new UserAdminService(seed.Db, seed.Users, new NotificationOutbox(seed.Db),
            Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" }), new NullStringLocalizer<ErrorMessages>(),
            Options.Create(new Pako.Api.Auth.PlatformOptions { AdminEmails = { "boss@pako.test" } }));
        var reports = (await admin.RolesAsync(seed.CompanyId)).Single(r => r.BuiltInKey == "reports");

        var boss = (await admin.InviteAsync(seed.CompanyId, new InviteUserRequest("boss@pako.test", null, false, reports.Id, null), seed.AdminUserId)).Value!;
        Assert.Null((await admin.AcceptAsync(new AcceptInvitationRequest(TokenFrom(boss.InviteUrl), null, Password))).Value);
        Assert.Null(await seed.Users.FindByEmailAsync("boss@pako.test"));

        var existing = new AppUser { Id = Guid.NewGuid(), Email = "existing@co.test", UserName = "existing@co.test" };
        await seed.Users.CreateAsync(existing, Password);
        var invited = (await admin.InviteAsync(seed.CompanyId, new InviteUserRequest("existing@co.test", null, false, reports.Id, null), seed.AdminUserId)).Value!;
        var token = TokenFrom(invited.InviteUrl);
        for (var i = 0; i < 5; i++)
        {
            Assert.Null((await admin.AcceptAsync(new AcceptInvitationRequest(token, null, "wrong"))).Value);
        }
        // Locked now: even the right password doesn't get in through the invitation.
        Assert.Null((await admin.AcceptAsync(new AcceptInvitationRequest(token, null, Password))).Value);
    }

    [Fact]
    public async Task LockedAccount_AWrongPasswordLooksLikeAnyOtherWrongPassword()
    {
        var seed = await SeedAsync();
        var auth = new Pako.Api.Controllers.AuthController(seed.Users,
            new Pako.Api.Auth.JwtTokenService(new Pako.Api.Auth.JwtOptions { Key = "test-only-signing-key-not-for-production-32chars+", Issuer = "Pako", Audience = "Pako" }),
            new NullStringLocalizer<ErrorMessages>(), new ActionTokenService());
        for (var i = 0; i < 5; i++)
        {
            await auth.Login(new LoginRequest("admin@co.test", "wrong"));
        }
        Assert.IsType<UnauthorizedResult>((await auth.Login(new LoginRequest("admin@co.test", "wrong"))).Result);
        Assert.Equal(StatusCodes.Status423Locked, Assert.IsType<ObjectResult>((await auth.Login(new LoginRequest("admin@co.test", Password))).Result).StatusCode);
    }
}
