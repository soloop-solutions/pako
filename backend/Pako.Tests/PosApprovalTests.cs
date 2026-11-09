using System.Security.Claims;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Tests;

public class PosApprovalTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private sealed class FakeClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 6, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private record Seed(PakoDbContext Db, Guid CompanyId, Guid Cashier, Guid Manager, PosOperatorService Operators);

    private async Task<Seed> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Till Co" };
        db.Companies.Add(company);
        var cashierRole = CompanyRole.FromTemplate(company.Id, CompanyRole.Templates.Single(t => t.Key == "cashier"));
        var managerRole = new CompanyRole { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Manager" };
        managerRole.Set(AccessModule.Pos, AccessLevel.Approve);
        db.CompanyRoles.AddRange(cashierRole, managerRole);
        var cashier = Guid.NewGuid();
        var manager = Guid.NewGuid();
        var cashierMembership = Membership.ForCompany(cashier, company.Id, MembershipRole.ClientStaff);
        cashierMembership.CompanyRoleId = cashierRole.Id;
        var managerMembership = Membership.ForCompany(manager, company.Id, MembershipRole.ClientStaff);
        managerMembership.CompanyRoleId = managerRole.Id;
        db.Memberships.AddRange(cashierMembership, managerMembership);
        await db.SaveChangesAsync();

        var operators = new PosOperatorService(db, new EphemeralDataProtectionProvider(), new NullStringLocalizer<ErrorMessages>());
        await operators.SetPinAsync(company.Id, manager, "4321");
        await operators.SetPinAsync(company.Id, cashier, "1111");
        await db.SaveChangesAsync();
        return new Seed(db, company.Id, cashier, manager, operators);
    }

    private static async Task<(IActionResult? Result, CompanyAccessContext Access)> FilterAsync(
        PakoDbContext db, PosApprovalTokens approvals, Guid userId, Guid companyId, AccessModule module, string? approvalHeader, bool approve = true)
    {
        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
        };
        if (approvalHeader is not null) httpContext.Request.Headers[CompanyAccessFilter.PosApprovalHeader] = approvalHeader;
        var routeData = new RouteData();
        routeData.Values["companyId"] = companyId.ToString();
        var actionContext = new ActionContext(httpContext, routeData, new ActionDescriptor());
        var executing = new ActionExecutingContext(actionContext, new List<IFilterMetadata>(), new Dictionary<string, object?>(), new object());
        var access = new CompanyAccessContext();
        await new CompanyAccessFilter(db, access, false, false, module, approve, approvals)
            .OnActionExecutionAsync(executing, () => Task.FromResult(new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), new object())));
        return (executing.Result, access);
    }

    private static PosController Controller(Seed seed, PosApprovalTokens approvals, Guid userId) =>
        new(seed.Db, null!, null!, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), seed.Operators, approvals)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
                }
            }
        };

    [Fact]
    public void ApprovalToken_WorksOnce_ForOneCompany_AndExpiresAfterAMinute()
    {
        var clock = new FakeClock();
        var tokens = new PosApprovalTokens(clock);
        var company = Guid.NewGuid();
        var manager = Guid.NewGuid();

        var (token, _) = tokens.Issue(company, manager);
        Assert.Equal(manager, tokens.TryConsume(token, company));
        Assert.Null(tokens.TryConsume(token, company));

        var (other, _) = tokens.Issue(company, manager);
        Assert.Null(tokens.TryConsume(other, Guid.NewGuid()));

        var (late, _) = tokens.Issue(company, manager);
        clock.Now = clock.Now.AddSeconds(61);
        Assert.Null(tokens.TryConsume(late, company));
        Assert.Null(tokens.TryConsume(null, company));
        Assert.Null(tokens.TryConsume("not-a-token", company));
    }

    [Fact]
    public void ApprovalAttempts_LockFiveWrongPinsForFifteenMinutes()
    {
        var clock = new FakeClock();
        var tokens = new PosApprovalTokens(clock);
        var user = Guid.NewGuid();
        for (var i = 0; i < 5; i++) tokens.RecordFailure(user);
        Assert.True(tokens.IsLocked(user));
        clock.Now = clock.Now.AddMinutes(15);
        Assert.False(tokens.IsLocked(user));
    }

    [Fact]
    public async Task Approve_ManagerPinGivesAToken_ACashiersPinOrAWrongOneDoesNot()
    {
        var seed = await SeedAsync();
        var approvals = new PosApprovalTokens();
        var controller = Controller(seed, approvals, seed.Cashier);

        var wrong = await controller.Approve(seed.CompanyId, new PosApprovalRequest("9999"));
        Assert.IsType<BadRequestObjectResult>(wrong.Result);
        var notAManager = await controller.Approve(seed.CompanyId, new PosApprovalRequest("1111"));
        Assert.IsType<BadRequestObjectResult>(notAManager.Result);

        var ok = Assert.IsType<OkObjectResult>((await controller.Approve(seed.CompanyId, new PosApprovalRequest("4321"))).Result);
        var response = Assert.IsType<PosApprovalResponse>(ok.Value);
        Assert.Equal(seed.Manager, response.ApproverUserId);
        Assert.Equal(seed.Manager, approvals.TryConsume(response.Token, seed.CompanyId));
    }

    [Fact]
    public async Task Approve_FiveWrongPins_AreLockedOut()
    {
        var seed = await SeedAsync();
        var controller = Controller(seed, new PosApprovalTokens(), seed.Cashier);
        for (var i = 0; i < 5; i++) await controller.Approve(seed.CompanyId, new PosApprovalRequest("0000"));

        var locked = await controller.Approve(seed.CompanyId, new PosApprovalRequest("4321"));
        Assert.Equal(StatusCodes.Status429TooManyRequests, Assert.IsType<ObjectResult>(locked.Result).StatusCode);
    }

    [Fact]
    public async Task ACashierIsRefusedAnApproveAction_UntilAManagersApprovalIsUsed_ThenOnlyOnce()
    {
        var seed = await SeedAsync();
        var approvals = new PosApprovalTokens();

        var (refused, _) = await FilterAsync(seed.Db, approvals, seed.Cashier, seed.CompanyId, AccessModule.Pos, null);
        Assert.IsType<ForbidResult>(refused);

        var (token, _) = approvals.Issue(seed.CompanyId, seed.Manager);
        var (allowed, access) = await FilterAsync(seed.Db, approvals, seed.Cashier, seed.CompanyId, AccessModule.Pos, token);
        Assert.Null(allowed);
        Assert.Equal(seed.Manager, access.PosApprovedBy);
        Assert.Equal(AccessLevel.Approve, access.LevelFor(AccessModule.Pos));

        var (again, _) = await FilterAsync(seed.Db, approvals, seed.Cashier, seed.CompanyId, AccessModule.Pos, token);
        Assert.IsType<ForbidResult>(again);
    }

    [Fact]
    public async Task AManagersApproval_OnlyRaisesPos_AndNeverAnotherCompanysTill()
    {
        var seed = await SeedAsync();
        var approvals = new PosApprovalTokens();

        var (sales, _) = await FilterAsync(seed.Db, approvals, seed.Cashier, seed.CompanyId, AccessModule.Sales, approvals.Issue(seed.CompanyId, seed.Manager).Token, approve: false);
        Assert.IsType<ForbidResult>(sales);

        var elsewhere = approvals.Issue(Guid.NewGuid(), seed.Manager).Token;
        var (otherCompany, _) = await FilterAsync(seed.Db, approvals, seed.Cashier, seed.CompanyId, AccessModule.Pos, elsewhere);
        Assert.IsType<ForbidResult>(otherCompany);
    }

    [Fact]
    public async Task PinSignIn_FiveWrongPins_AreLockedOut_AndAGoodSignInClearsTheCount()
    {
        var seed = await SeedAsync();
        var controller = Controller(seed, new PosApprovalTokens(), seed.Cashier);

        for (var i = 0; i < 4; i++) Assert.IsType<BadRequestObjectResult>((await controller.PinSignIn(seed.CompanyId, new PosPinSignInRequest("0000"))).Result);
        Assert.IsType<OkObjectResult>((await controller.PinSignIn(seed.CompanyId, new PosPinSignInRequest("1111"))).Result);

        for (var i = 0; i < 5; i++) await controller.PinSignIn(seed.CompanyId, new PosPinSignInRequest("0000"));
        var locked = await controller.PinSignIn(seed.CompanyId, new PosPinSignInRequest("1111"));
        Assert.Equal(StatusCodes.Status429TooManyRequests, Assert.IsType<ObjectResult>(locked.Result).StatusCode);
    }

    [Fact]
    public async Task ReferenceData_IsRefusedToARoleWithNoBusinessArea_ButOpenToTheirOwnDataEndpoints()
    {
        var seed = await SeedAsync();
        var company = seed.CompanyId;
        var employeeRole = CompanyRole.FromTemplate(company, CompanyRole.Templates.Single(t => t.Key == "employee"));
        seed.Db.CompanyRoles.Add(employeeRole);
        var user = Guid.NewGuid();
        var membership = Membership.ForCompany(user, company, MembershipRole.ClientStaff);
        membership.CompanyRoleId = employeeRole.Id;
        seed.Db.Memberships.Add(membership);
        await seed.Db.SaveChangesAsync();

        async Task<IActionResult?> Run(Guid who, bool anyMember)
        {
            var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, who.ToString()) }, "TestAuth")) };
            var route = new RouteData();
            route.Values["companyId"] = company.ToString();
            var actionContext = new ActionContext(http, route, new ActionDescriptor());
            var executing = new ActionExecutingContext(actionContext, new List<IFilterMetadata>(), new Dictionary<string, object?>(), new object());
            await new CompanyAccessFilter(seed.Db, new CompanyAccessContext(), false, false, AccessModule.None, false, null, anyMember)
                .OnActionExecutionAsync(executing, () => Task.FromResult(new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), new object())));
            return executing.Result;
        }

        Assert.IsType<ForbidResult>(await Run(user, false));
        Assert.Null(await Run(user, true));
        Assert.Null(await Run(seed.Cashier, false));
    }
}
