using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Domain.Pos;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class AccessAndInputGuardTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private async Task<PakoDbContext> NewDbAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        return db;
    }

    private static bool Allowed(Type controller, string verb, string template, CompanyFeature enabled)
    {
        var method = controller.GetMethods().Single(m =>
            m.GetCustomAttributes<HttpMethodAttribute>().Any(a => a.HttpMethods.Contains(verb) && a.Template == template));
        var gates = controller.GetCustomAttributes<RequireCompanyFeatureAttribute>()
            .Concat(method.GetCustomAttributes<RequireCompanyFeatureAttribute>());
        return gates.All(g => (enabled & (CompanyFeature)g.Arguments![0]) != CompanyFeature.None);
    }

    [Fact]
    public void HotelPack_OpensHotelRoutes_AndEventsPack_OpensEventRoutes()
    {
        Assert.True(Allowed(typeof(PosHotelController), "GET", "hotel/calendar", CompanyFeature.Hotel));
        Assert.False(Allowed(typeof(PosHotelController), "GET", "hotel/calendar", CompanyFeature.Events));
        Assert.False(Allowed(typeof(PosHotelController), "GET", "hotel/guest-register", CompanyFeature.Events | CompanyFeature.Hospitality));
        Assert.True(Allowed(typeof(PosHotelController), "GET", "events", CompanyFeature.Events));
        Assert.False(Allowed(typeof(PosHotelController), "GET", "events", CompanyFeature.Hotel));
        Assert.False(Allowed(typeof(PosHotelController), "POST", "ticketed-events", CompanyFeature.Hotel));
    }

    [Fact]
    public void HospitalityPack_AloneOpensTabs()
    {
        Assert.True(Allowed(typeof(PosTabsController), "POST", "tabs", CompanyFeature.Hospitality));
        Assert.False(Allowed(typeof(PosTabsController), "POST", "tabs", CompanyFeature.Hotel | CompanyFeature.Events));
    }

    [Fact]
    public void RealEstatePack_OpensSalesRoutes_AndRentalsKeepsBuildingsAndUnits()
    {
        Assert.True(Allowed(typeof(RealEstateController), "POST", "contracts", CompanyFeature.RealEstate));
        Assert.False(Allowed(typeof(RealEstateController), "POST", "contracts", CompanyFeature.Rentals));
        Assert.False(Allowed(typeof(RealEstateController), "GET", "reservations", CompanyFeature.Rentals));
        Assert.True(Allowed(typeof(RealEstateController), "GET", "buildings", CompanyFeature.Rentals));
        Assert.True(Allowed(typeof(RealEstateController), "GET", "units", CompanyFeature.RealEstate));
        Assert.False(Allowed(typeof(RealEstateController), "GET", "buildings", CompanyFeature.Hotel));
    }

    [Fact]
    public void CloseSession_NeedsPosApprove()
    {
        var access = typeof(PosController).GetMethod(nameof(PosController.CloseSession))!.GetCustomAttribute<RequireCompanyAccessAttribute>()!;
        Assert.Equal(AccessModule.Pos, access.Arguments![2]);
        Assert.Equal(true, access.Arguments![3]);
    }

    [Fact]
    public void LeaseSetupAndTheRentRun_NeedSalesApprove_ButMeterReadingsOnlyEdit()
    {
        foreach (var (verb, template) in new[] { ("POST", "leases"), ("PUT", "leases/{leaseId:guid}"), ("POST", "leases/{leaseId:guid}/activate"), ("POST", "leases/{leaseId:guid}/end"), ("POST", "run") })
        {
            var method = typeof(RentalsController).GetMethods().Single(m =>
                m.GetCustomAttributes<HttpMethodAttribute>().Any(a => a.HttpMethods.Contains(verb) && a.Template == template));
            var access = method.GetCustomAttribute<RequireCompanyAccessAttribute>()!;
            Assert.Equal(AccessModule.Sales, access.Arguments![2]);
            Assert.Equal(true, access.Arguments![3]);
        }

        var reading = typeof(RentalsController).GetMethods().Single(m =>
            m.GetCustomAttributes<HttpMethodAttribute>().Any(a => a.Template == "leases/{leaseId:guid}/meters/{meterId:guid}/reading"));
        Assert.Equal(false, reading.GetCustomAttribute<RequireCompanyAccessAttribute>()!.Arguments![3]);
    }

    [Fact]
    public async Task WarehousesAndOnHand_AreRefusedToAUserWithNoSalesPurchasesPosOrInventoryAccess()
    {
        var company = Guid.NewGuid();
        var employee = CompanyAccessContext.ForStaff(company, Guid.NewGuid(), null, new CompanyRole { Id = Guid.NewGuid(), CompanyId = company, Name = "Employee" }, null);
        var controller = new InventoryController(null!, null!, new NullStringLocalizer<ErrorMessages>(), null!, employee);

        Assert.IsType<ForbidResult>((await controller.Warehouses(company)).Result);
        Assert.IsType<ForbidResult>((await controller.OnHand(company, new[] { Guid.NewGuid() })).Result);
    }

    [Fact]
    public void TheAccessFilter_IsBuiltByTheContainer_WithThePosApprovalTokens()
    {
        var services = new ServiceCollection();
        services.AddDbContext<PakoDbContext>(o => o.UseNpgsql("Host=localhost;Database=unused"));
        services.AddScoped<CompanyAccessContext>();
        services.AddSingleton<PosApprovalTokens>();
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        var attribute = new RequireCompanyAccessAttribute(approve: true, module: AccessModule.Pos);
        Assert.IsType<CompanyAccessFilter>(attribute.CreateInstance(scope.ServiceProvider));
        Assert.IsType<CompanyAccessFilter>(new RequireCompanyAccessAttribute().CreateInstance(scope.ServiceProvider));
    }

    private sealed class FakeClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 6, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public void ActionTokenLockout_LiftsFifteenMinutesAfterTheLastFailedAttempt()
    {
        var clock = new FakeClock();
        var tokens = new ActionTokenService(clock);
        var user = Guid.NewGuid();
        for (var i = 0; i < 5; i++) tokens.RecordFailedAttempt(user);
        Assert.True(tokens.IsRateLimited(user));

        clock.Now = clock.Now.AddMinutes(14);
        Assert.True(tokens.IsRateLimited(user));

        clock.Now = clock.Now.AddMinutes(1);
        Assert.False(tokens.IsRateLimited(user));

        tokens.RecordFailedAttempt(user);
        Assert.False(tokens.IsRateLimited(user));
    }

    [Fact]
    public void ActionTokenLockout_ASuccessfulPasswordClearsTheCount()
    {
        var tokens = new ActionTokenService(new FakeClock());
        var user = Guid.NewGuid();
        for (var i = 0; i < 4; i++) tokens.RecordFailedAttempt(user);
        tokens.ResetFailedAttempts(user);
        tokens.RecordFailedAttempt(user);
        Assert.False(tokens.IsRateLimited(user));
    }

    private static ControllerContext UserContext() => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "TestAuth"))
        }
    };

    [Fact]
    public async Task PayrollRun_WithNoDates_IsRefusedWith400()
    {
        var db = await NewDbAsync();
        var runs = new PayrollRunsController(db, new PayrollRunComposer(db, new PayrollCalculationService(), new PayrollParameterProvider(db)),
            new PayslipDocumentService(db), new NotificationOutbox(db), new NullStringLocalizer<ErrorMessages>()) { ControllerContext = UserContext() };
        var result = await runs.Create(Guid.NewGuid(), new CreatePayrollRunRequest(default, default));
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task AnnualStatements_WithNoYear_AreRefusedWith400()
    {
        var db = await NewDbAsync();
        var localizer = new NullStringLocalizer<ErrorMessages>();
        var outbox = new NotificationOutbox(db);
        var me = new MeController(db, new LeaveService(db, outbox, localizer), new PayslipDocumentService(db), outbox, localizer) { ControllerContext = UserContext() };
        Assert.IsType<BadRequestObjectResult>((await me.AnnualStatement(Guid.NewGuid(), 0)).Result);
        Assert.IsType<BadRequestObjectResult>(await me.AnnualStatementPdf(Guid.NewGuid(), 0));
        var runs = new PayrollRunsController(db, new PayrollRunComposer(db, new PayrollCalculationService(), new PayrollParameterProvider(db)),
            new PayslipDocumentService(db), outbox, localizer) { ControllerContext = UserContext() };
        Assert.IsType<BadRequestObjectResult>((await runs.AnnualStatement(Guid.NewGuid(), Guid.NewGuid(), 0)).Result);
        Assert.IsType<BadRequestObjectResult>(await runs.AnnualStatementPdf(Guid.NewGuid(), Guid.NewGuid(), 0));
    }

    [Fact]
    public async Task DashboardAndPosReports_WithNoDates_AreRefusedWith400()
    {
        var db = await NewDbAsync();
        var localizer = new NullStringLocalizer<ErrorMessages>();
        var dashboard = new DashboardController(db, null!, CompanyAccessContext.Unrestricted(), localizer);
        Assert.IsType<BadRequestObjectResult>((await dashboard.Get(Guid.NewGuid(), default, default)).Result);

        var reports = new PosReportsController(db, null!, null!, localizer);
        Assert.IsType<BadRequestObjectResult>((await reports.Sales(Guid.NewGuid(), default, default)).Result);
        Assert.IsType<BadRequestObjectResult>((await reports.UsageVariance(Guid.NewGuid(), default, default)).Result);
    }

    [Fact]
    public async Task Items_RefuseAnotherCompanysDefaultTaxCode()
    {
        var db = await NewDbAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Items Co" };
        db.Companies.Add(company);
        var revenue = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "4000", Name = "Revenue", AccountType = AccountType.Income };
        var expense = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "5000", Name = "Cost", AccountType = AccountType.Expense };
        var stock = new Account { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "1300", Name = "Stock", AccountType = AccountType.CurrentAsset };
        db.Accounts.AddRange(revenue, expense, stock);
        await db.SaveChangesAsync();
        var items = new ItemsController(db, new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>());

        var created = await items.Create(company.Id, new CreateItemRequest("Widget", "pcs", DefaultTaxDefinitionId: Guid.NewGuid(),
            DefaultRevenueAccountId: revenue.Id, DefaultExpenseAccountId: expense.Id, DefaultInventoryAccountId: stock.Id));
        Assert.IsType<BadRequestObjectResult>(created.Result);
    }

    [Fact]
    public async Task MembershipHolderAndEventBooking_RefuseAnotherCompanysCustomer()
    {
        var db = await NewDbAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Pos Co" };
        db.Companies.Add(company);
        var warehouse = new Warehouse { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "W1", Name = "Main" };
        var store = new Store { Id = Guid.NewGuid(), CompanyId = company.Id, Code = "S1", Name = "Hall store", WarehouseId = warehouse.Id };
        var plan = new Item { Id = Guid.NewGuid(), CompanyId = company.Id, Code = 1, Name = "Plan", Unit = "pcs" };
        db.Warehouses.Add(warehouse);
        db.Items.Add(plan);
        await db.SaveChangesAsync();
        db.PosStores.Add(store);
        await db.SaveChangesAsync();
        var membership = new CustomerMembership { Id = Guid.NewGuid(), CompanyId = company.Id, Number = "M-1", PlanItemId = plan.Id };
        var venue = new Venue { Id = Guid.NewGuid(), CompanyId = company.Id, StoreId = store.Id, Name = "Hall", Capacity = 100 };
        db.PosMemberships.Add(membership);
        db.PosVenues.Add(venue);
        await db.SaveChangesAsync();
        var localizer = new NullStringLocalizer<ErrorMessages>();
        var foreign = Guid.NewGuid();

        var services = new PosServicesController(db, null!, null!, null!, localizer);
        Assert.IsType<BadRequestObjectResult>((await services.Holder(company.Id, membership.Id, new SaveMembershipHolderRequest("Arta", null, foreign))).Result);

        var hotel = new PosHotelController(db, null!, null!, null!, localizer);
        var booking = new SaveEventBookingRequest(venue.StoreId, venue.Id, new DateOnly(2026, 12, 1), "Arta", 20, CustomerId: foreign);
        Assert.IsType<BadRequestObjectResult>((await hotel.CreateEvent(company.Id, booking)).Result);
    }

    [Fact]
    public async Task UserIdsMustBeMembersOfTheCompany_DirectOrThroughItsFirm_AndActive()
    {
        var db = await NewDbAsync();
        var firm = new Firm { Id = Guid.NewGuid(), Name = "Firm" };
        var company = new Company { Id = Guid.NewGuid(), Name = "Member Co", FirmId = firm.Id };
        db.Firms.Add(firm);
        db.Companies.Add(company);
        var direct = Guid.NewGuid();
        var viaFirm = Guid.NewGuid();
        var inactive = Guid.NewGuid();
        var inactiveMembership = Membership.ForCompany(inactive, company.Id, MembershipRole.ClientStaff);
        inactiveMembership.IsActive = false;
        db.Memberships.AddRange(Membership.ForCompany(direct, company.Id, MembershipRole.ClientStaff), Membership.ForFirm(viaFirm, firm.Id, MembershipRole.FirmAccountant), inactiveMembership);
        await db.SaveChangesAsync();

        Assert.True(await CompanyMembers.ExistsAsync(db, company.Id, direct));
        Assert.True(await CompanyMembers.ExistsAsync(db, company.Id, viaFirm));
        Assert.False(await CompanyMembers.ExistsAsync(db, company.Id, inactive));
        Assert.False(await CompanyMembers.ExistsAsync(db, company.Id, Guid.NewGuid()));

        var vehicles = new VehiclesController(db, new StockService(db, new NullStringLocalizer<ErrorMessages>()), new NullStringLocalizer<ErrorMessages>());
        Assert.IsType<BadRequestObjectResult>((await vehicles.Create(company.Id, new SaveVehicleRequest("01-123-AB", null, null, DriverUserId: Guid.NewGuid()))).Result);
    }
}
