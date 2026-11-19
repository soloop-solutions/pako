using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Options;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Api.Services.Notifications;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Invoicing;
using Pako.Domain.Notifications;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Infrastructure.Identity;

namespace Pako.Tests;

// Client feedback phase 5 — the customer portal, on real Postgres through the real services and
// controllers: a customer contact is invited and accepts, is refused by every normal company
// endpoint, sees only its own prices, orders and invoices, and an order it places becomes a draft
// sales order that staff confirm into a draft invoice.
public class PortalTests : IAsyncLifetime
{
    private const string Password = "Portal-Test-1!";
    private static readonly TaxComputationService Tax = new();
    private static readonly DateOnly Today = PortalService.Today;
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private sealed class Co
    {
        public required PakoDbContext Db { get; init; }
        public required UserAdminService Admin { get; init; }
        public required Guid Id { get; init; }
        public required Guid StaffUserId { get; init; }
        public required Guid Customer { get; init; }
        public required Guid OtherCustomer { get; init; }
        public required Guid Coffee { get; init; }
        public required Guid Retired { get; init; }
        public required Guid S18 { get; init; }
    }

    private static NullStringLocalizer<ErrorMessages> L => new();

    private static T As<T>(T controller, Guid userId, IServiceProvider? services = null) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth")),
                RequestServices = services!,
            }
        };
        return controller;
    }

    private async Task<Co> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(db);
        services.AddDataProtection();
        services.AddIdentityCore<AppUser>(o => o.User.RequireUniqueEmail = true).AddEntityFrameworkStores<PakoDbContext>().AddDefaultTokenProviders();
        var users = services.BuildServiceProvider().GetRequiredService<UserManager<AppUser>>();

        var staff = new AppUser { Id = Guid.NewGuid(), Email = "owner@co.test", UserName = "owner@co.test", CompanyLimit = null };
        await users.CreateAsync(staff, Password);
        var created = await As(new CompaniesController(db, L), staff.Id).Create(new CreateCompanyRequest("Coffee Wholesale"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;
        var s18 = (await db.TaxDefinitions.AsNoTracking().SingleAsync(t => t.CompanyId == companyId && t.Code == "S18")).Id;

        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Bar Prishtina", IsCustomer = true, FiscalNumber = "811000101", PaymentTermDays = 15 };
        var other = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Cafe Prizren", IsCustomer = true, FiscalNumber = "811000102" };
        var coffee = new Item
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Code = 1, Name = "Espresso beans 1kg", Unit = "kg", Type = ItemType.Goods,
            DefaultUnitPrice = 20m, WholesalePrice = 16m, DefaultTaxDefinitionId = s18, SalesUnit = "box", SalesUnitFactor = 6m,
        };
        var retired = new Item { Id = Guid.NewGuid(), CompanyId = companyId, Code = 2, Name = "Old blend", Unit = "kg", DefaultUnitPrice = 10m, IsActive = false };
        db.Partners.AddRange(customer, other);
        db.Items.AddRange(coffee, retired);
        await db.SaveChangesAsync();

        var admin = new UserAdminService(db, users, new NotificationOutbox(db), Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" }), L);
        return new Co
        {
            Db = db, Admin = admin, Id = companyId, StaffUserId = staff.Id, Customer = customer.Id, OtherCustomer = other.Id,
            Coffee = coffee.Id, Retired = retired.Id, S18 = s18,
        };
    }

    // Invites a contact of the customer and accepts: the new login's id.
    private static async Task<Guid> PortalLoginAsync(Co c, string email = "orders@bar.test", Guid? partnerId = null)
    {
        var invited = await c.Admin.InviteAsync(c.Id, new InviteUserRequest(email, "Bar orders", false, null, null, partnerId ?? c.Customer), c.StaffUserId);
        Assert.Null(invited.Error);
        var url = invited.Value!.InviteUrl;
        var token = Uri.UnescapeDataString(url[(url.IndexOf("token=", StringComparison.Ordinal) + 6)..]);
        var accepted = await c.Admin.AcceptAsync(new AcceptInvitationRequest(token, null, Password));
        Assert.Null(accepted.Error);
        return accepted.Value!.Id;
    }

    private static async Task<(IActionResult? Result, PortalContext Portal)> PortalFilterAsync(PakoDbContext db, Guid userId, Guid companyId)
    {
        var (context, executing) = Executing(userId, companyId);
        var portal = new PortalContext();
        await new PortalAccessFilter(db, portal).OnActionExecutionAsync(executing,
            () => Task.FromResult(new ActionExecutedContext(context, new List<IFilterMetadata>(), new object())));
        return (executing.Result, portal);
    }

    private static async Task<IActionResult?> CompanyFilterAsync(PakoDbContext db, Guid userId, Guid companyId, AccessModule module)
    {
        var (context, executing) = Executing(userId, companyId);
        await new CompanyAccessFilter(db, new CompanyAccessContext(), false, false, module).OnActionExecutionAsync(executing,
            () => Task.FromResult(new ActionExecutedContext(context, new List<IFilterMetadata>(), new object())));
        return executing.Result;
    }

    private static (ActionContext, ActionExecutingContext) Executing(Guid userId, Guid companyId)
    {
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
        };
        var route = new RouteData();
        route.Values["companyId"] = companyId.ToString();
        var context = new ActionContext(http, route, new ActionDescriptor());
        return (context, new ActionExecutingContext(context, new List<IFilterMetadata>(), new Dictionary<string, object?>(), new object()));
    }

    private static async Task<PortalController> PortalAsync(Co c, Guid userId)
    {
        var (result, portal) = await PortalFilterAsync(c.Db, userId, c.Id);
        Assert.Null(result);
        var prices = new PriceListService(c.Db, new StockService(c.Db, L), new NumberSeriesService(c.Db), L);
        return As(new PortalController(c.Db, new PortalService(c.Db, prices, Tax, L), portal, new SalesCreditService(c.Db),
            new NotificationOutbox(c.Db), Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" }), L), userId);
    }

    // Staff Sales orders, able to make the draft invoice on confirm (it builds an InvoicesController).
    private static SalesOrdersController Orders(Co c)
    {
        var services = new ServiceCollection();
        services.AddSingleton(c.Db);
        services.AddSingleton<ITaxComputationService>(Tax);
        services.AddSingleton<IDocumentNumberService, DocumentNumberService>();
        services.AddSingleton(new NumberSeriesService(c.Db));
        services.AddSingleton<IStringLocalizer<ErrorMessages>>(L);
        services.AddSingleton(CompanyAccessContext.Unrestricted(c.Id, c.StaffUserId));
        return As(new SalesOrdersController(c.Db, new NumberSeriesService(c.Db), L, CompanyAccessContext.Unrestricted(c.Id, c.StaffUserId), Tax,
            new SalesCreditService(c.Db), new NotificationOutbox(c.Db), Options.Create(new EmailOptions { AppBaseUrl = "https://app.test" })),
            c.StaffUserId, services.BuildServiceProvider());
    }

    private static InvoicesController Invoices(Co c) =>
        As(new InvoicesController(c.Db, Tax, new DocumentNumberService(), new NumberSeriesService(c.Db), L, CompanyAccessContext.Unrestricted(c.Id, c.StaffUserId)), c.StaffUserId);

    private static async Task<PortalOrderResponse> PlaceAsync(PortalController portal, Co c, decimal quantity = 2m, string? unit = null)
    {
        var result = await portal.Place(c.Id, new PlacePortalOrderRequest(new List<PortalOrderLineRequest> { new(c.Coffee, quantity, unit) }, "PO-77"));
        return (PortalOrderResponse)Assert.IsAssignableFrom<ObjectResult>(result.Result).Value!;
    }

    [Fact]
    public async Task CustomerInvitation_CreatesPortalLogin_RefusedByEveryCompanyArea()
    {
        var c = await SeedAsync();
        var invited = await c.Admin.InviteAsync(c.Id, new InviteUserRequest("orders@bar.test", null, true, null, null, c.Customer), c.StaffUserId);
        Assert.Equal(("Customer", "Bar Prishtina"), (invited.Value!.User.Access, invited.Value.User.PartnerName));
        Assert.NotNull((await c.Admin.InviteAsync(c.Id, new InviteUserRequest("x@bar.test", null, false, null, null, Guid.NewGuid()), c.StaffUserId)).Error);
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Roaster", IsVendor = true };
        c.Db.Partners.Add(vendor);
        await c.Db.SaveChangesAsync();
        Assert.NotNull((await c.Admin.InviteAsync(c.Id, new InviteUserRequest("x@roaster.test", null, false, null, null, vendor.Id), c.StaffUserId)).Error);

        var userId = await PortalLoginAsync(c, "second@bar.test");
        var membership = await c.Db.Memberships.AsNoTracking().SingleAsync(m => m.UserId == userId);
        Assert.Equal((MembershipRole.ClientCustomer, (Guid?)c.Customer, (Guid?)null), (membership.Role, membership.PartnerId, membership.CompanyRoleId));
        Assert.Contains(await c.Admin.UsersAsync(c.Id, c.StaffUserId), u => u.UserId == userId && u.Access == "Customer" && u.PartnerId == c.Customer);
        Assert.NotNull(await c.Admin.UpdateUserAsync(c.Id, membership.Id, new UpdateCompanyUserRequest(true, null, null), c.StaffUserId));

        // Every normal area refuses the portal login, reference data included.
        foreach (var module in new[] { AccessModule.None, AccessModule.Sales, AccessModule.Partners, AccessModule.Items, AccessModule.Accounting, AccessModule.Self })
        {
            Assert.IsType<ForbidResult>(await CompanyFilterAsync(c.Db, userId, c.Id, module));
        }
        var companies = await As(new CompaniesController(c.Db, L), userId).List();
        Assert.Empty((List<CompanyResponse>)Assert.IsType<OkObjectResult>(companies.Result).Value!);

        // The portal lets it in as this customer; staff don't pass the portal filter.
        var (result, portal) = await PortalFilterAsync(c.Db, userId, c.Id);
        Assert.Null(result);
        Assert.Equal(c.Customer, portal.PartnerId);
        Assert.IsType<ForbidResult>((await PortalFilterAsync(c.Db, c.StaffUserId, c.Id)).Result);
        var mine = (List<PortalCompanyResponse>)Assert.IsType<OkObjectResult>((await (await PortalAsync(c, userId)).Companies()).Result).Value!;
        Assert.Equal(("Coffee Wholesale", "Bar Prishtina"), (Assert.Single(mine).CompanyName, mine[0].PartnerName));

        // A deactivated login is out of the portal too.
        Assert.Null(await c.Admin.SetActiveAsync(c.Id, membership.Id, false, c.StaffUserId));
        Assert.IsType<ForbidResult>((await PortalFilterAsync(c.Db, userId, c.Id)).Result);
    }

    [Fact]
    public async Task Catalogue_ShowsThisCustomersPrices_AndTheCartPricesLikeTheOrder()
    {
        var c = await SeedAsync();
        var customer = await c.Db.Partners.SingleAsync(p => p.Id == c.Customer);
        customer.PriceTier = PriceTier.Wholesale;
        c.Db.DiscountRules.Add(new DiscountRule
        {
            Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Autumn", Percent = 10m, ValidFrom = Today.AddDays(-1), ValidTo = Today.AddDays(1),
            PartnerId = c.Customer, ItemId = c.Coffee, IsActive = true,
        });
        await c.Db.SaveChangesAsync();
        var portal = await PortalAsync(c, await PortalLoginAsync(c));

        var page = (PaginatedResponse<PortalCatalogueItemResponse>)Assert.IsType<OkObjectResult>((await portal.Catalogue(c.Id)).Result).Value!;
        var coffee = Assert.Single(page.Items); // the inactive item is not offered
        Assert.Equal((16m, 10m, 14.40m), (coffee.Price, coffee.DiscountPercent, coffee.PriceAfterDiscount));
        Assert.Equal(("box", 96m), (Assert.Single(coffee.Units).UnitName, coffee.Units[0].Price));
        Assert.Null(coffee.InStock);

        var cart = (PortalCartResponse)Assert.IsType<OkObjectResult>((await portal.Cart(c.Id,
            new PortalCartRequest(new List<PortalOrderLineRequest> { new(c.Coffee, 1m, "box") }))).Result).Value!;
        Assert.Equal((96m, 10m, 86.40m), (cart.Lines[0].UnitPrice, cart.Lines[0].DiscountPercent, cart.Gross));
        Assert.Equal(cart.Gross, cart.Net + cart.Vat);

        Assert.IsType<BadRequestObjectResult>((await portal.Cart(c.Id, new PortalCartRequest(new List<PortalOrderLineRequest> { new(c.Retired, 1m) }))).Result);
        Assert.IsType<BadRequestObjectResult>((await portal.Cart(c.Id, new PortalCartRequest(new List<PortalOrderLineRequest> { new(c.Coffee, 0m) }))).Result);
        Assert.IsType<BadRequestObjectResult>((await portal.Cart(c.Id, new PortalCartRequest(new List<PortalOrderLineRequest>()))).Result);

        var order = await PlaceAsync(portal, c, 1m, "box");
        Assert.Equal((cart.Gross, "Submitted", true), (order.Gross, order.Status, order.CanCancel));
        var saved = await c.Db.SalesOrders.AsNoTracking().Include(o => o.Lines).SingleAsync(o => o.Id == order.Id);
        Assert.Equal((SalesOrderState.Draft, SalesOrderSource.Portal, c.Customer, "PO-77"), (saved.State, saved.Source, saved.PartnerId, saved.CustomerReference));
        Assert.Equal((96m, 10m, (Guid?)c.S18, 6m), (saved.Lines[0].UnitPrice, saved.Lines[0].DiscountPercent, saved.Lines[0].TaxDefinitionId, saved.Lines[0].UnitFactor));
        Assert.Equal(NotificationTemplates.PortalOrderPlaced, (await c.Db.Notifications.AsNoTracking().SingleAsync(n => n.RecipientEmail == "owner@co.test"
            && n.Template == NotificationTemplates.PortalOrderPlaced)).Template);
    }

    [Fact]
    public async Task Customer_SeesOnlyItsOwnOrders_AndWithdrawsOnlyBeforeTheCompanyAnswers()
    {
        var c = await SeedAsync();
        var portal = await PortalAsync(c, await PortalLoginAsync(c));
        var otherPortal = await PortalAsync(c, await PortalLoginAsync(c, "cafe@prizren.test", c.OtherCustomer));
        var mine = await PlaceAsync(portal, c);
        var theirs = await PlaceAsync(otherPortal, c);

        var list = (PaginatedResponse<PortalOrderSummaryResponse>)Assert.IsType<OkObjectResult>((await portal.Orders(c.Id)).Result).Value!;
        Assert.Equal(mine.Id, Assert.Single(list.Items).Id);
        Assert.IsType<NotFoundResult>((await portal.Order(c.Id, theirs.Id)).Result);
        Assert.IsType<NotFoundResult>((await portal.Cancel(c.Id, theirs.Id)).Result);

        var cancelled = (PortalOrderResponse)Assert.IsType<OkObjectResult>((await portal.Cancel(c.Id, mine.Id)).Result).Value!;
        Assert.Equal(("Cancelled", false), (cancelled.Status, cancelled.CanCancel));
        Assert.IsType<BadRequestObjectResult>((await portal.Cancel(c.Id, mine.Id)).Result);

        // Once staff confirmed, the customer can't withdraw it.
        Assert.IsType<OkObjectResult>((await Orders(c).Confirm(c.Id, theirs.Id, new ConfirmSalesOrderRequest(null))).Result);
        Assert.IsType<BadRequestObjectResult>((await otherPortal.Cancel(c.Id, theirs.Id)).Result);
    }

    [Fact]
    public async Task ConfirmingAPortalOrder_MakesItsDraftInvoice_AndTellsTheCustomer()
    {
        var c = await SeedAsync();
        var portal = await PortalAsync(c, await PortalLoginAsync(c));
        var order = await PlaceAsync(portal, c, 3m);

        var confirmed = (SalesOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Confirm(c.Id, order.Id, new ConfirmSalesOrderRequest(null))).Result).Value!;
        Assert.Equal((SalesOrderState.Confirmed, (SalesOrderSource?)SalesOrderSource.Portal, (string?)null), (confirmed.State, confirmed.Source, confirmed.DraftInvoiceWarning));
        var invoice = await c.Db.Invoices.AsNoTracking().Include(i => i.Lines).SingleAsync(i => i.Id == confirmed.DraftInvoiceId);
        Assert.Equal((InvoiceState.Draft, c.Customer, Today.AddDays(15)), (invoice.State, invoice.PartnerId, invoice.DueDate));
        var line = Assert.Single(invoice.Lines);
        Assert.Equal((3m, 20m, (Guid?)confirmed.Lines[0].Id), (line.Quantity, line.UnitPrice, line.SalesOrderLineId));
        Assert.Equal(new[] { NotificationTemplates.UserInvitation, NotificationTemplates.PortalOrderConfirmed },
            await c.Db.Notifications.AsNoTracking().Where(n => n.RecipientEmail == "orders@bar.test").OrderBy(n => n.CreatedAt).Select(n => n.Template).ToArrayAsync());

        var seen = (PortalOrderResponse)Assert.IsType<OkObjectResult>((await portal.Order(c.Id, order.Id)).Result).Value!;
        Assert.Equal(("Confirmed", confirmed.Number), (seen.Status, seen.Reference));
        Assert.Empty(seen.Invoices); // a draft isn't the customer's yet

        // Staff-taken orders stay as they were: no invoice on confirm.
        var staffOrder = (SalesOrderResponse)Assert.IsAssignableFrom<ObjectResult>((await Orders(c).Create(c.Id, new SaveSalesOrderRequest(c.Customer, Today,
            new List<SalesOrderLineRequest> { new(c.Coffee, null, 1m, 20m, c.S18) }))).Result).Value!;
        var staffConfirmed = (SalesOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Confirm(c.Id, staffOrder.Id, new ConfirmSalesOrderRequest(null))).Result).Value!;
        Assert.Null(staffConfirmed.DraftInvoiceId);
        var listed = (PaginatedResponse<SalesOrderSummaryResponse>)Assert.IsType<OkObjectResult>((await Orders(c).List(c.Id, source: SalesOrderSource.Portal)).Result).Value!;
        Assert.Equal(order.Id, Assert.Single(listed.Items).Id);
    }

    [Fact]
    public async Task Invoices_OnlyPostedAndOwn_WithWhatIsStillOpen()
    {
        var c = await SeedAsync();
        var portal = await PortalAsync(c, await PortalLoginAsync(c));
        var order = await PlaceAsync(portal, c, 5m);
        var confirmed = (SalesOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Confirm(c.Id, order.Id, new ConfirmSalesOrderRequest(null))).Result).Value!;
        Assert.Empty(((PaginatedResponse<PortalInvoiceSummaryResponse>)Assert.IsType<OkObjectResult>((await portal.Invoices(c.Id)).Result).Value!).Items);

        Assert.IsType<OkObjectResult>((await Invoices(c).Post(c.Id, confirmed.DraftInvoiceId!.Value)).Result);
        var otherInvoice = (InvoiceResponse)Assert.IsAssignableFrom<ObjectResult>((await Invoices(c).Create(c.Id, new CreateInvoiceRequest(c.OtherCustomer, Today, Today,
            new List<CreateInvoiceLineRequest> { new("Beans", 1m, 20m, c.S18, null, null, c.Coffee) }))).Result).Value!;
        Assert.IsType<OkObjectResult>((await Invoices(c).Post(c.Id, otherInvoice.Id)).Result);

        var list = (PaginatedResponse<PortalInvoiceSummaryResponse>)Assert.IsType<OkObjectResult>((await portal.Invoices(c.Id)).Result).Value!;
        var mine = Assert.Single(list.Items);
        Assert.Equal((100m, (decimal?)100m, false, "Invoice"), (mine.Gross, mine.Open, mine.Overdue, mine.Kind));
        var detail = (PortalInvoiceResponse)Assert.IsType<OkObjectResult>((await portal.Invoice(c.Id, mine.Id)).Result).Value!;
        Assert.Equal((100m, "Bar Prishtina", 1), (detail.Gross, detail.PartnerName, detail.Lines.Count));
        Assert.Equal(detail.Gross, detail.Net + detail.Vat);
        Assert.IsType<NotFoundResult>((await portal.Invoice(c.Id, otherInvoice.Id)).Result);

        // The PDF: same scope — own posted documents only.
        var documents = new InvoiceDocumentService(c.Db, Tax);
        var pdf = Assert.IsType<FileContentResult>(await portal.InvoicePdf(c.Id, mine.Id, documents));
        Assert.Equal("application/pdf", pdf.ContentType);
        Assert.IsType<NotFoundResult>(await portal.InvoicePdf(c.Id, otherInvoice.Id, documents));

        var summary = (PortalSummaryResponse)Assert.IsType<OkObjectResult>((await portal.Summary(c.Id)).Result).Value!;
        Assert.Equal((100m, "Bar Prishtina"), (summary.Outstanding, summary.PartnerName));
        var seen = (PortalOrderResponse)Assert.IsType<OkObjectResult>((await portal.Order(c.Id, order.Id)).Result).Value!;
        Assert.Equal(mine.Id, Assert.Single(seen.Invoices).Id);
    }
}
