using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using InvoiceDocumentType = Pako.Domain.Invoicing.DocumentType;

namespace Pako.Tests;

// docs/POS_PLAN.md P6 — distribution, end to end on real Postgres through the real controllers:
// quote → order → delivery note (stock out, cost of goods sold) → invoice from the delivery (revenue
// only); credit limit and overdue blocks; customer price lists with volume tiers; a van's day.
public class DistributionTests : IAsyncLifetime
{
    private static readonly TaxComputationService Tax = new();
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private sealed class Co
    {
        public required PakoDbContext Db { get; init; }
        public required Guid Id { get; init; }
        public required Guid UserId { get; init; }
        public required Guid Customer { get; init; }
        public required Guid Vendor { get; init; }
        public required Guid S18 { get; init; }
        public required Guid B18 { get; init; }
        public required Guid Laptop { get; init; }
        public Guid Account(string code) => Db.Accounts.AsNoTracking().Single(a => a.CompanyId == Id && a.Code == code).Id;
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

    private async Task<Co> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var userId = Guid.NewGuid();
        var created = await As(new CompaniesController(db, new NullStringLocalizer<ErrorMessages>()), userId).Create(new CreateCompanyRequest("Wholesale Co"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;
        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Market", IsCustomer = true, FiscalNumber = "811000001" };
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Vendor", IsVendor = true, FiscalNumber = "811000002" };
        db.Partners.AddRange(customer, vendor);
        var laptop = new Item { Id = Guid.NewGuid(), CompanyId = companyId, Code = 1, Name = "Laptop", Unit = "pc", Type = ItemType.Goods, TrackInventory = true };
        db.Items.Add(laptop);
        await db.SaveChangesAsync();
        var taxes = await db.TaxDefinitions.AsNoTracking().Where(t => t.CompanyId == companyId).ToListAsync();
        return new Co
        {
            Db = db, Id = companyId, UserId = userId, Customer = customer.Id, Vendor = vendor.Id,
            S18 = taxes.Single(t => t.Code == "S18").Id, B18 = taxes.Single(t => t.Code == "B18").Id, Laptop = laptop.Id,
        };
    }

    private static readonly DateOnly Today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
    private static readonly DateOnly D1 = new(2026, 3, 1);

    private static NullStringLocalizer<ErrorMessages> L => new();
    private static StockService Stock(Co c) => new(c.Db, L);

    private static SalesOrdersController Orders(Co c) =>
        As(new SalesOrdersController(c.Db, new NumberSeriesService(c.Db), L, CompanyAccessContext.Unrestricted(), Tax, new SalesCreditService(c.Db)), c.UserId);

    private static InvoicesController Invoices(Co c) =>
        As(new InvoicesController(c.Db, Tax, new DocumentNumberService(), new NumberSeriesService(c.Db), L, CompanyAccessContext.Unrestricted()), c.UserId);

    private static BillsController Bills(Co c) => As(new BillsController(c.Db, Tax, L, CompanyAccessContext.Unrestricted()), c.UserId);

    private static StockDocumentsController Documents(Co c) =>
        As(new StockDocumentsController(c.Db, new StockDocumentService(c.Db, Stock(c), new NumberSeriesService(c.Db), L, Tax), Stock(c), L), c.UserId);

    private static InventoryController Inventory(Co c) => As(new InventoryController(c.Db, Stock(c), L, Tax, CompanyAccessContext.Unrestricted()), c.UserId);

    private static PriceListsController Prices(Co c) =>
        As(new PriceListsController(c.Db, new PriceListService(c.Db, Stock(c), new NumberSeriesService(c.Db), L), L), c.UserId);

    private static DistributionController Distribution(Co c) =>
        As(new DistributionController(c.Db, L, CompanyAccessContext.Unrestricted(), new SalesCreditService(c.Db), Stock(c)), c.UserId);

    private static async Task BillAsync(Co c, DateOnly date, decimal qty, decimal grossUnit, Guid? warehouseId = null)
    {
        var created = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, $"V-{Guid.NewGuid():N}"[..10], date, date,
            new List<CreateBillLineRequest> { new("Laptops", qty, grossUnit, c.B18, null, null, c.Laptop) }, WarehouseId: warehouseId));
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        Assert.IsType<OkObjectResult>((await Bills(c).Post(c.Id, bill.Id)).Result);
    }

    private static async Task<SalesOrderResponse> OrderAsync(Co c, decimal qty, decimal price, Guid? warehouseId = null, Guid? visitId = null)
    {
        var result = await Orders(c).Create(c.Id, new SaveSalesOrderRequest(c.Customer, Today,
            new List<SalesOrderLineRequest> { new(c.Laptop, null, qty, price, c.S18) }, WarehouseId: warehouseId, RouteVisitId: visitId));
        return (SalesOrderResponse)Assert.IsAssignableFrom<ObjectResult>(result.Result).Value!;
    }

    private static async Task<SalesOrderResponse> GetAsync(Co c, Guid id) =>
        (SalesOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Get(c.Id, id)).Result).Value!;

    private static async Task<StockDocumentResponse> PostDocumentAsync(Co c, Guid id) =>
        (StockDocumentResponse)Assert.IsType<OkObjectResult>((await Documents(c).Post(c.Id, id)).Result).Value!;

    private static async Task<InvoiceResponse> DraftInvoiceAsync(Co c, IEnumerable<CreateInvoiceLineRequest> lines, Guid? warehouseId = null, DateOnly? date = null)
    {
        var created = await Invoices(c).Create(c.Id, new CreateInvoiceRequest(c.Customer, date ?? Today, date ?? Today, lines.ToList(), WarehouseId: warehouseId));
        return (InvoiceResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
    }

    private static async Task<decimal> OnHandAsync(Co c) =>
        (await c.Db.ItemCosts.AsNoTracking().SingleAsync(k => k.ItemId == c.Laptop)).Quantity;

    // Quote and order are numbered on their own series; the delivery takes the goods out with cost
    // of goods sold; the invoice made from the delivery posts revenue only, can't bill more than was
    // delivered, and the order reads its progress back from both.
    [Fact]
    public async Task Orders_QuoteConfirmDeliverAndInvoice_TheGoodsLeaveOnce()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        var order = await OrderAsync(c, 6m, 236m);
        Assert.Equal((SalesOrderState.Draft, 1416m), (order.State, order.Total));
        Assert.Equal(1200m, order.Net);

        var quoted = (SalesOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Quote(c.Id, order.Id)).Result).Value!;
        Assert.Equal(($"OF-0001/{Today.Year}", SalesOrderState.Quoted), (quoted.QuoteNumber, quoted.State));
        // Nothing can be delivered before the order is confirmed.
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Deliver(c.Id, order.Id)).Result);
        var confirmed = (SalesOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Confirm(c.Id, order.Id, new ConfirmSalesOrderRequest())).Result).Value!;
        Assert.Equal(($"SO-0001/{Today.Year}", SalesOrderState.Confirmed), (confirmed.Number, confirmed.State));
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Update(c.Id, order.Id, new SaveSalesOrderRequest(c.Customer, Today,
            new List<SalesOrderLineRequest> { new(c.Laptop, null, 1m, 1m, c.S18) }))).Result);

        // Deliver: a draft with the open quantity; pressing twice doesn't make a second one.
        var deliveryId = (Guid)Assert.IsType<OkObjectResult>((await Orders(c).Deliver(c.Id, order.Id)).Result).Value!;
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Deliver(c.Id, order.Id)).Result);
        var delivery = await PostDocumentAsync(c, deliveryId);
        Assert.Equal(($"FD-0001/{Today.Year}", 600m), (delivery.Number, delivery.TotalValue));
        Assert.Equal(4m, await OnHandAsync(c));
        var deliveryEntry = await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == delivery.JournalEntryId).ToListAsync();
        Assert.Equal(600m, deliveryEntry.Where(l => l.AccountId == c.Account(StockService.CogsAccountCode)).Sum(l => l.Debit));
        Assert.Equal(600m, deliveryEntry.Where(l => l.AccountId == c.Account(StockService.InventoryAccountCode)).Sum(l => l.Credit));

        order = await GetAsync(c, order.Id);
        Assert.Equal((6m, 0m, 6m, "full", "none"), (order.Lines[0].Delivered, order.Lines[0].ToDeliver, order.Lines[0].ToInvoice, order.Delivery, order.Invoicing));

        // Invoice four from the delivery: revenue only, no stock moves, no second cost of goods sold.
        var draft = (SalesInvoiceDraftResponse)Assert.IsType<OkObjectResult>((await Orders(c).InvoiceDraft(c.Id, order.Id)).Result).Value!;
        var line = Assert.Single(draft.Lines);
        Assert.Equal((6m, delivery.Lines[0].Id, delivery.Number), (line.Quantity, line.DeliveryLineId, line.DeliveryNumber));
        CreateInvoiceLineRequest Bill(decimal qty) =>
            new(line.Description, qty, line.UnitPrice, line.TaxDefinitionId, null, line.DiscountPercent, line.ItemId, line.UnitName, null, line.SalesOrderLineId, line.DeliveryLineId);
        var first = await DraftInvoiceAsync(c, new[] { Bill(4m) });
        Assert.Equal((order.Lines[0].Id, delivery.Lines[0].Id), (first.Lines[0].SalesOrderLineId, first.Lines[0].DeliveryLineId));
        var posted = (InvoiceResponse)Assert.IsType<OkObjectResult>((await Invoices(c).Post(c.Id, first.Id)).Result).Value!;
        Assert.Equal(4m, await OnHandAsync(c));
        Assert.False(await c.Db.StockMoves.AnyAsync(m => m.SourceId == first.Id));
        var invoiceEntry = await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntryId == posted.JournalEntryId).ToListAsync();
        Assert.DoesNotContain(invoiceEntry, l => l.AccountId == c.Account(StockService.CogsAccountCode));

        // Three more would bill more than the delivery sent.
        var second = await DraftInvoiceAsync(c, new[] { Bill(3m) });
        Assert.IsType<BadRequestObjectResult>((await Invoices(c).Post(c.Id, second.Id)).Result);
        c.Db.ChangeTracker.Clear();

        order = await GetAsync(c, order.Id);
        Assert.Equal((4m, 3m, 2m, "partly"), (order.Lines[0].Invoiced, order.Lines[0].InvoicedDraft, order.Lines[0].ToInvoice, order.Invoicing));
        Assert.Equal(new[] { "delivery", "invoice", "invoice" }, order.Documents.Select(d => d.Kind).OrderBy(k => k).ToArray());
        // The draft for three already counts: what's left to put on an invoice is nothing.
        Assert.IsType<BadRequestObjectResult>((await Orders(c).InvoiceDraft(c.Id, order.Id)).Result);

        // A return of one comes back at the delivery's cost.
        var ret = await Invoices(c).Create(c.Id, new CreateInvoiceRequest(c.Customer, Today, Today,
            new List<CreateInvoiceLineRequest> { new("Laptop", 1m, 236m, c.S18, null, null, c.Laptop) }, InvoiceDocumentType.SalesReturn, first.Id));
        var retId = ((InvoiceResponse)Assert.IsAssignableFrom<ObjectResult>(ret.Result).Value!).Id;
        Assert.IsType<OkObjectResult>((await Invoices(c).Post(c.Id, retId)).Result);
        Assert.Equal(5m, await OnHandAsync(c));
        Assert.Equal(100m, (await c.Db.StockMoves.AsNoTracking().SingleAsync(m => m.SourceId == retId)).Value);

        // Goods went out: the order can't be cancelled, only closed.
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Cancel(c.Id, order.Id)).Result);
        Assert.Equal(SalesOrderState.Closed,
            ((SalesOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Close(c.Id, order.Id)).Result).Value!).State);
    }

    // An order not delivered can be invoiced straight away: the invoice then sends the goods itself,
    // and the order counts them delivered.
    [Fact]
    public async Task Orders_InvoicedWithoutADelivery_TheInvoiceSendsTheGoods()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        var order = await OrderAsync(c, 3m, 236m);
        await Orders(c).Confirm(c.Id, order.Id, new ConfirmSalesOrderRequest());
        // Only delivered goods by default.
        Assert.IsType<BadRequestObjectResult>((await Orders(c).InvoiceDraft(c.Id, order.Id)).Result);
        var draft = (SalesInvoiceDraftResponse)Assert.IsType<OkObjectResult>((await Orders(c).InvoiceDraft(c.Id, order.Id, undelivered: true)).Result).Value!;
        var line = Assert.Single(draft.Lines);
        Assert.Null(line.DeliveryLineId);
        var invoice = await DraftInvoiceAsync(c, new[] { new CreateInvoiceLineRequest(line.Description, line.Quantity, line.UnitPrice, line.TaxDefinitionId, null,
            line.DiscountPercent, line.ItemId, line.UnitName, null, line.SalesOrderLineId) });
        // While the draft waits, a delivery has nothing left to send.
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Deliver(c.Id, order.Id)).Result);
        Assert.IsType<OkObjectResult>((await Invoices(c).Post(c.Id, invoice.Id)).Result);
        Assert.Equal(7m, await OnHandAsync(c));
        order = await GetAsync(c, order.Id);
        Assert.Equal((3m, 3m, "full", "full"), (order.Lines[0].Delivered, order.Lines[0].Invoiced, order.Delivery, order.Invoicing));
    }

    // Confirming over the credit limit, or while an invoice is overdue past the customer's block, is
    // refused; Sales: Approve confirms anyway with a reason, which the order keeps.
    [Fact]
    public async Task Confirm_IsBlockedOverTheCreditLimit_AndWhileInvoicesAreOverdue()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        var customer = await c.Db.Partners.SingleAsync(p => p.Id == c.Customer);
        customer.CreditLimit = 1000m;
        await c.Db.SaveChangesAsync();

        var order = await OrderAsync(c, 5m, 236m);
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Confirm(c.Id, order.Id, new ConfirmSalesOrderRequest())).Result);
        var overridden = (SalesOrderResponse)Assert.IsType<OkObjectResult>(
            (await Orders(c).Confirm(c.Id, order.Id, new ConfirmSalesOrderRequest("Pays cash on delivery"))).Result).Value!;
        Assert.Equal((SalesOrderState.Confirmed, "Pays cash on delivery"), (overridden.State, overridden.BlockOverrideReason));
        var status = (CreditStatusResponse)Assert.IsType<OkObjectResult>((await Orders(c).CreditStatus(c.Id, c.Customer)).Result).Value!;
        Assert.Equal((0m, 1180m, -180m), (status.Outstanding, status.OpenOrders, status.Available!.Value));

        // An invoice due in March, unpaid: with a 30-day block, new orders stop.
        customer.CreditLimit = null;
        customer.OverdueBlockDays = 30;
        await c.Db.SaveChangesAsync();
        var old = await DraftInvoiceAsync(c, new[] { new CreateInvoiceLineRequest("Laptop", 1m, 236m, c.S18, null, null, c.Laptop) }, date: D1);
        Assert.IsType<OkObjectResult>((await Invoices(c).Post(c.Id, old.Id)).Result);
        status = (CreditStatusResponse)Assert.IsType<OkObjectResult>((await Orders(c).CreditStatus(c.Id, c.Customer)).Result).Value!;
        Assert.True(status.OverdueBlocked);
        Assert.Equal((236m, Today.DayNumber - D1.DayNumber), (status.Overdue, status.OldestOverdueDays));
        var next = await OrderAsync(c, 1m, 236m);
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Confirm(c.Id, next.Id, new ConfirmSalesOrderRequest())).Result);
        Assert.IsType<OkObjectResult>((await Orders(c).Confirm(c.Id, next.Id, new ConfirmSalesOrderRequest("Agreed a payment plan"))).Result);
    }

    // A customer's own list comes before the shop and company lists, and a volume tier the quantity
    // reaches beats the list's ordinary price. Several customer lists can exist next to the one
    // company list.
    [Fact]
    public async Task CustomerPriceLists_WithVolumeTiers()
    {
        var c = await SeedAsync();
        async Task<PriceListResponse> List(string name, bool customer) =>
            (PriceListResponse)Assert.IsAssignableFrom<ObjectResult>((await Prices(c).CreateList(c.Id, new SavePriceListRequest(name, null, true, customer))).Result).Value!;
        var company = await List("Retail", false);
        var wholesale = await List("Wholesale", true);
        var horeca = await List("Horeca", true);
        Assert.True(wholesale.IsCustomerList);
        async Task Post(Guid list, params PriceChangeLineRequest[] lines)
        {
            var draft = (PriceChangeResponse)Assert.IsAssignableFrom<ObjectResult>((await Prices(c).CreateChange(c.Id,
                new SavePriceChangeRequest(list, D1, lines.ToList()))).Result).Value!;
            Assert.IsType<OkObjectResult>((await Prices(c).PostChange(c.Id, draft.Id)).Result);
        }
        await Post(company.Id, new PriceChangeLineRequest(c.Laptop, 250m));
        await Post(wholesale.Id, new(c.Laptop, 230m), new(c.Laptop, 210m, 10m), new(c.Laptop, 200m, 50m));
        await Post(horeca.Id, new PriceChangeLineRequest(c.Laptop, 240m));

        var customer = await c.Db.Partners.SingleAsync(p => p.Id == c.Customer);
        customer.PriceListId = wholesale.Id;
        await c.Db.SaveChangesAsync();

        async Task<ResolvedPriceResponse> Resolve(Guid? partner, decimal qty) =>
            Assert.Single((List<ResolvedPriceResponse>)Assert.IsType<OkObjectResult>((await Prices(c).Resolve(c.Id, new List<Guid> { c.Laptop }, null, Today,
                partner, new List<decimal> { qty })).Result).Value!);
        Assert.Equal(("company", 250m), ((await Resolve(null, 1m)).Source, (await Resolve(null, 1m)).Price));
        Assert.Equal(("customer", 230m, (decimal?)null), ((await Resolve(c.Customer, 1m)).Source, (await Resolve(c.Customer, 1m)).Price, (await Resolve(c.Customer, 1m)).TierMinQuantity));
        Assert.Equal((210m, (decimal?)10m), ((await Resolve(c.Customer, 12m)).Price, (await Resolve(c.Customer, 12m)).TierMinQuantity));
        Assert.Equal(200m, (await Resolve(c.Customer, 50m)).Price);

        var items = (PaginatedResponse<PriceListItemResponse>)Assert.IsType<OkObjectResult>((await Prices(c).Items(c.Id, wholesale.Id, Today)).Result).Value!;
        var row = items.Items.Single(i => i.ItemId == c.Laptop);
        Assert.Equal((230m, 250m), (row.Price!.Value, row.FallbackPrice!.Value));
        Assert.Equal(new[] { 10m, 50m }, row.Tiers!.Select(t => t.MinQuantity).ToArray());
        // A customer list has no warehouse, and can't turn into a shop list.
        Assert.IsType<BadRequestObjectResult>((await Prices(c).UpdateList(c.Id, wholesale.Id, new SavePriceListRequest("Wholesale", null, true, false))).Result);
    }

    // A van's day: loaded by transfer, a visit checked in on the route, an order taken there and an
    // invoice from the van; the settlement shows the stock moved and the money the day brought.
    [Fact]
    public async Task VanDay_Route_Visit_Load_AndSettlement()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        var main = ((List<WarehouseResponse>)((OkObjectResult)(await Inventory(c).Warehouses(c.Id)).Result!).Value!).Single(w => w.IsDefault).Id;
        var van = (WarehouseResponse)Assert.IsAssignableFrom<ObjectResult>((await Inventory(c).CreateWarehouse(c.Id,
            new SaveWarehouseRequest("VAN1", "Van 1", null, true, true, c.UserId))).Result).Value!;
        Assert.True(van.IsVan);

        var route = (SalesRouteResponse)Assert.IsAssignableFrom<ObjectResult>((await Distribution(c).CreateRoute(c.Id, new SaveSalesRouteRequest("Prishtina north",
            c.UserId, van.Id, 127, new List<SalesRouteStopRequest> { new(c.Customer, "Back door") }))).Result).Value!;
        var day = Assert.Single((List<RouteDayResponse>)Assert.IsType<OkObjectResult>((await Distribution(c).MyDay(c.Id)).Result).Value!);
        Assert.Equal(("Market", (Guid?)null), (day.Stops[0].PartnerName, day.Stops[0].VisitId));

        // Pre-selling: an order for 3 waits; the load sheet asks for it.
        var preOrder = await OrderAsync(c, 3m, 236m, van.Id);
        await Orders(c).Confirm(c.Id, preOrder.Id, new ConfirmSalesOrderRequest());
        var load = Assert.Single((List<VanLoadLineResponse>)Assert.IsType<OkObjectResult>((await Distribution(c).Load(c.Id, van.Id)).Result).Value!);
        Assert.Equal((3m, 0m, 3m), (load.Ordered, load.OnVan, load.ToLoad));

        // Morning load of six by transfer.
        var transfer = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await Documents(c).Create(c.Id, new SaveStockDocumentRequest(
            StockDocumentType.Transfer, Today, main, new List<StockDocumentLineRequest> { new(c.Laptop, 6m) }, van.Id))).Result).Value!;
        await PostDocumentAsync(c, transfer.Id);

        // At the customer: check in, sell two from the van on an invoice, collect cash.
        var visit = (RouteVisitResponse)Assert.IsAssignableFrom<ObjectResult>((await Distribution(c).CheckIn(c.Id,
            new CheckInRequest(c.Customer, route.Id, 42.6629, 21.1655, 12))).Result).Value!;
        Assert.IsType<BadRequestObjectResult>((await Distribution(c).CheckIn(c.Id, new CheckInRequest(c.Customer, null, 120, 0))).Result);
        var taken = await OrderAsync(c, 1m, 236m, van.Id, visit.Id);
        var invoice = await DraftInvoiceAsync(c, new[] { new CreateInvoiceLineRequest("Laptop", 2m, 236m, c.S18, null, null, c.Laptop) }, van.Id);
        Assert.IsType<OkObjectResult>((await Invoices(c).Post(c.Id, invoice.Id)).Result);
        var updated = (RouteVisitResponse)Assert.IsType<OkObjectResult>((await Distribution(c).UpdateVisit(c.Id, visit.Id,
            new UpdateVisitRequest(RouteVisitOutcome.Sale, 472m, "Paid in cash"))).Result).Value!;
        Assert.Equal((RouteVisitOutcome.Sale, 472m, taken.Id), (updated.Outcome, updated.Collected, Assert.Single(updated.SalesOrderIds)));
        Assert.NotNull(updated.CheckOutAt);

        var summary = (VisitSummaryResponse)Assert.IsType<OkObjectResult>((await Distribution(c).Visits(c.Id)).Result).Value!;
        Assert.Equal((1, 1, 1m, 236m, 236m, 472m), (summary.Visits, summary.WithOrder, summary.StrikeRate, summary.OrderValue, summary.DropSize, summary.Collected));

        var settlement = (VanSettlementResponse)Assert.IsType<OkObjectResult>((await Distribution(c).Settlement(c.Id, van.Id)).Result).Value!;
        var row = Assert.Single(settlement.Lines);
        Assert.Equal((0m, 6m, 2m, 0m, 0m, 4m), (row.Opening, row.Loaded, row.Sold, row.Returned, row.Unloaded, row.Closing));
        Assert.Equal((1, 472m, 472m, 1), (settlement.Invoices, settlement.Invoiced, settlement.Collected, settlement.Visits));
        // A warehouse that isn't a van has no settlement.
        Assert.IsType<NotFoundResult>((await Distribution(c).Settlement(c.Id, main)).Result);
    }
}
