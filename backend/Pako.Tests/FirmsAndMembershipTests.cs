using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Companies;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

public class FirmsAndMembershipTests
{
    private static PakoDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<PakoDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new PakoDbContext(options);
    }

    private static UserManager<AppUser> NewUserManager(PakoDbContext db)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(db);
        services.AddIdentityCore<AppUser>().AddEntityFrameworkStores<PakoDbContext>();
        return services.BuildServiceProvider().GetRequiredService<UserManager<AppUser>>();
    }

    private static ClaimsPrincipal PrincipalFor(Guid userId) =>
        new(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"));

    private static T WithUser<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = PrincipalFor(userId) }
        };
        return controller;
    }

    private static async Task<IActionResult?> RunFilterAsync(IAsyncActionFilter filter, Guid userId, string routeKey, Guid routeValue)
    {
        var httpContext = new DefaultHttpContext { User = PrincipalFor(userId) };
        var routeData = new RouteData();
        routeData.Values[routeKey] = routeValue.ToString();

        var actionContext = new ActionContext(httpContext, routeData, new ActionDescriptor());
        var executingContext = new ActionExecutingContext(
            actionContext, new List<IFilterMetadata>(), new Dictionary<string, object?>(), controller: new object());

        ActionExecutionDelegate next = () =>
            Task.FromResult(new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), controller: new object()));

        await filter.OnActionExecutionAsync(executingContext, next);
        return executingContext.Result;
    }

    [Fact]
    public async Task CreateFirm_GrantsCreatorFirmAdmin()
    {
        var db = NewContext();
        var userId = Guid.NewGuid();
        var controller = WithUser(new FirmsController(db), userId);

        var result = await controller.Create(new CreateFirmRequest("Acme Accounting"));

        var created = Assert.IsType<FirmResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        var membership = await db.Memberships.SingleAsync(m => m.FirmId == created.Id);
        Assert.Equal(userId, membership.UserId);
        Assert.Equal(MembershipRole.FirmAdmin, membership.Role);
    }

    [Fact]
    public async Task CompaniesList_ShowsFirmCompanyToEveryFirmMember()
    {
        var db = NewContext();
        var firmAdmin = Guid.NewGuid();
        var firmAccountant = Guid.NewGuid();
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Acme Accounting" };
        db.Firms.Add(firm);
        db.Memberships.Add(Membership.ForFirm(firmAdmin, firm.Id, MembershipRole.FirmAdmin));
        db.Memberships.Add(Membership.ForFirm(firmAccountant, firm.Id, MembershipRole.FirmAccountant));
        await db.SaveChangesAsync();

        var companiesController = WithUser(new CompaniesController(db), firmAdmin);
        var createResult = await companiesController.Create(new CreateCompanyRequest("Client Co", firm.Id));
        var created = Assert.IsType<CompanyResponse>(Assert.IsType<ObjectResult>(createResult.Result).Value);

        Assert.False(await db.Memberships.AnyAsync(m => m.CompanyId == created.Id),
            "firm-owned company should not get an auto-created direct membership row for the creator");

        var accountantController = WithUser(new CompaniesController(db), firmAccountant);
        var listResult = await accountantController.List();
        var companies = Assert.IsType<List<CompanyResponse>>(Assert.IsType<OkObjectResult>(listResult.Result).Value);

        Assert.Contains(companies, c => c.Id == created.Id);
    }

    [Fact]
    public async Task CreateCompany_UnderFirm_RejectsNonFirmAdmin()
    {
        var db = NewContext();
        var firmAccountant = Guid.NewGuid();
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Acme Accounting" };
        db.Firms.Add(firm);
        db.Memberships.Add(Membership.ForFirm(firmAccountant, firm.Id, MembershipRole.FirmAccountant));
        await db.SaveChangesAsync();

        var controller = WithUser(new CompaniesController(db), firmAccountant);
        var result = await controller.Create(new CreateCompanyRequest("Client Co", firm.Id));

        Assert.IsType<ForbidResult>(result.Result);
    }

    [Fact]
    public async Task FirmAccessFilter_AdminOnly_ForbidsNonAdminFirmMember()
    {
        var db = NewContext();
        var accountant = Guid.NewGuid();
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Acme Accounting" };
        db.Firms.Add(firm);
        db.Memberships.Add(Membership.ForFirm(accountant, firm.Id, MembershipRole.FirmAccountant));
        await db.SaveChangesAsync();

        var result = await RunFilterAsync(new FirmAccessFilter(db, adminOnly: true), accountant, "firmId", firm.Id);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task FirmAccessFilter_AdminOnly_AllowsFirmAdmin()
    {
        var db = NewContext();
        var admin = Guid.NewGuid();
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Acme Accounting" };
        db.Firms.Add(firm);
        db.Memberships.Add(Membership.ForFirm(admin, firm.Id, MembershipRole.FirmAdmin));
        await db.SaveChangesAsync();

        var result = await RunFilterAsync(new FirmAccessFilter(db, adminOnly: true), admin, "firmId", firm.Id);

        Assert.Null(result);
    }

    [Fact]
    public async Task CompanyAccessFilter_AdminOnly_ForbidsClientViewer()
    {
        var db = NewContext();
        var viewer = Guid.NewGuid();
        var company = new Company { Id = Guid.NewGuid(), Name = "Client Co" };
        db.Companies.Add(company);
        db.Memberships.Add(Membership.ForCompany(viewer, company.Id, MembershipRole.ClientViewer));
        await db.SaveChangesAsync();

        var result = await RunFilterAsync(
            new CompanyAccessFilter(db, writeAccess: true, adminOnly: true), viewer, "companyId", company.Id);

        Assert.IsType<ForbidResult>(result);
    }

    [Fact]
    public async Task CompanyAccessFilter_FirmCascadedMember_HasAccessWithoutDirectCompanyMembership()
    {
        var db = NewContext();
        var firmAdmin = Guid.NewGuid();
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Acme Accounting" };
        var company = new Company { Id = Guid.NewGuid(), Name = "Client Co", FirmId = firm.Id };
        db.Firms.Add(firm);
        db.Companies.Add(company);
        db.Memberships.Add(Membership.ForFirm(firmAdmin, firm.Id, MembershipRole.FirmAdmin));
        await db.SaveChangesAsync();

        Assert.False(await db.Memberships.AnyAsync(m => m.CompanyId == company.Id));

        var result = await RunFilterAsync(new CompanyAccessFilter(db, writeAccess: true), firmAdmin, "companyId", company.Id);

        Assert.Null(result);
    }

    [Fact]
    public async Task CompanyAccessFilter_UserWithFirmCascadedWriteRoleAndDirectReadOnlyRole_GrantsWriteAccess()
    {
        // Most-permissive-wins: a user with BOTH a firm-cascaded FirmAccountant (write-capable)
        // AND a direct ClientViewer (read-only) on the same company must get write access — the
        // union of what either membership grants, not whichever row an unordered query happened
        // to pick first (the bug this fix closes).
        var db = NewContext();
        var userId = Guid.NewGuid();
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Acme Accounting" };
        var company = new Company { Id = Guid.NewGuid(), Name = "Client Co", FirmId = firm.Id };
        db.Firms.Add(firm);
        db.Companies.Add(company);
        db.Memberships.Add(Membership.ForFirm(userId, firm.Id, MembershipRole.FirmAccountant));
        db.Memberships.Add(Membership.ForCompany(userId, company.Id, MembershipRole.ClientViewer));
        await db.SaveChangesAsync();

        var result = await RunFilterAsync(new CompanyAccessFilter(db, writeAccess: true), userId, "companyId", company.Id);

        Assert.Null(result);
    }

    [Fact]
    public async Task AddCompanyMember_NonexistentEmail_ReturnsNotFound()
    {
        var db = NewContext();
        var userManager = NewUserManager(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Client Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var controller = new CompanyMembersController(db, userManager);
        var result = await controller.Create(company.Id, new AddMemberRequest("ghost@example.com", MembershipRole.ClientViewer));

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task AddFirmMember_NonexistentEmail_ReturnsNotFound()
    {
        var db = NewContext();
        var userManager = NewUserManager(db);
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Acme Accounting" };
        db.Firms.Add(firm);
        await db.SaveChangesAsync();

        var controller = new FirmMembersController(db, userManager);
        var result = await controller.Create(firm.Id, new AddMemberRequest("ghost@example.com", MembershipRole.FirmAccountant));

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task AddCompanyMember_ValidEmail_CreatesMembership()
    {
        var db = NewContext();
        var userManager = NewUserManager(db);
        var newUser = new AppUser { UserName = "member@example.com", Email = "member@example.com" };
        await userManager.CreateAsync(newUser, "Passw0rd!123");

        var company = new Company { Id = Guid.NewGuid(), Name = "Client Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var controller = new CompanyMembersController(db, userManager);
        var result = await controller.Create(company.Id, new AddMemberRequest("member@example.com", MembershipRole.ClientViewer));

        var created = Assert.IsType<MemberResponse>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(MembershipRole.ClientViewer, created.Role);
        Assert.Equal("member@example.com", created.Email);
        Assert.True(await db.Memberships.AnyAsync(m => m.UserId == newUser.Id && m.CompanyId == company.Id));
    }

    [Fact]
    public async Task AddCompanyMember_RejectsFirmScopedRole()
    {
        var db = NewContext();
        var userManager = NewUserManager(db);
        var company = new Company { Id = Guid.NewGuid(), Name = "Client Co" };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var controller = new CompanyMembersController(db, userManager);
        var result = await controller.Create(company.Id, new AddMemberRequest("someone@example.com", MembershipRole.FirmAdmin));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }
}
