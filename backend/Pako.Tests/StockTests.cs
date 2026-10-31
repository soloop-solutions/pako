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
using Pako.Domain.Ledger;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using BillDocumentType = Pako.Domain.Bills.DocumentType;
using InvoiceDocumentType = Pako.Domain.Invoicing.DocumentType;

namespace Pako.Tests;

// docs/INVENTORY_PLAN.md phase 1, end to end on real Postgres through the real controllers: bills
// bring stock in, invoices take it out with cost of goods sold, stock documents, the negative-stock
// rule, back-dating, and the stock value always tying out to the ledger.
public class StockTests : IAsyncLifetime
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
        var created = await As(new CompaniesController(db, new NullStringLocalizer<ErrorMessages>()), userId).Create(new CreateCompanyRequest("Stock Co"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;

        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Customer", IsCustomer = true, FiscalNumber = "811000001" };
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

    private static InvoicesController Invoices(Co c) =>
        As(new InvoicesController(c.Db, Tax, new DocumentNumberService(), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), c.UserId);

    private static BillsController Bills(Co c) =>
        As(new BillsController(c.Db, Tax, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), c.UserId);

    private static StockService Stock(Co c) => new(c.Db, new NullStringLocalizer<ErrorMessages>());

    private static StockDocumentsController Documents(Co c) =>
        As(new StockDocumentsController(c.Db, new StockDocumentService(c.Db, Stock(c), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
            Stock(c), new NullStringLocalizer<ErrorMessages>()), c.UserId);

    private static InventoryController Inventory(Co c) =>
        As(new InventoryController(c.Db, Stock(c), new NullStringLocalizer<ErrorMessages>(), Tax, CompanyAccessContext.Unrestricted()), c.UserId);

    // A bill for goods: prices are VAT-inclusive (gross), so 118.00 is 100.00 net at 18%.
    private static async Task<(IActionResult? Error, BillResponse? Bill)> BillAsync(Co c, DateOnly date, decimal qty, decimal grossUnit,
        BillDocumentType type = BillDocumentType.Bill, Guid? original = null, Guid? warehouseId = null)
    {
        var created = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, $"V-{Guid.NewGuid():N}"[..10], date, date,
            new List<CreateBillLineRequest> { new("Laptops", qty, grossUnit, c.B18, null, null, c.Laptop) }, type, original, WarehouseId: warehouseId));
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        var posted = await Bills(c).Post(c.Id, bill.Id);
        return posted.Result is OkObjectResult ok ? (null, (BillResponse)ok.Value!) : (posted.Result, null);
    }

    private static async Task<(IActionResult? Error, InvoiceResponse? Invoice)> InvoiceAsync(Co c, DateOnly date, decimal qty, decimal grossUnit,
        InvoiceDocumentType type = InvoiceDocumentType.Invoice, Guid? original = null)
    {
        var created = await Invoices(c).Create(c.Id, new CreateInvoiceRequest(c.Customer, date, date,
            new List<CreateInvoiceLineRequest> { new("Laptops", qty, grossUnit, c.S18, null, null, c.Laptop) }, type, original));
        var invoice = (InvoiceResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        var posted = await Invoices(c).Post(c.Id, invoice.Id);
        return posted.Result is OkObjectResult ok ? (null, (InvoiceResponse)ok.Value!) : (posted.Result, null);
    }

    private static async Task<StockValuationResponse> ValuationAsync(Co c, DateOnly asOf) =>
        (StockValuationResponse)Assert.IsType<OkObjectResult>((await Inventory(c).Valuation(c.Id, asOf)).Result).Value!;

    private static async Task<ItemCost> CostAsync(Co c) => await c.Db.ItemCosts.AsNoTracking().SingleAsync(k => k.ItemId == c.Laptop);

    private static async Task<List<JournalEntryLine>> LinesAsync(Co c, Guid sourceDocumentId) =>
        await c.Db.JournalEntryLines.AsNoTracking().Where(l => l.JournalEntry!.SourceDocumentId == sourceDocumentId).ToListAsync();

    private static readonly DateOnly D1 = new(2026, 3, 1), D2 = new(2026, 3, 10), D3 = new(2026, 3, 20);

    [Fact]
    public async Task ABill_BringsStockIn_AndAnInvoice_PostsCostOfGoodsSold_InItsOwnEntry()
    {
        var c = await SeedAsync();
        var (billError, bill) = await BillAsync(c, D1, 10, 118m);
        Assert.Null(billError);

        // The bill line posted to stock (120100), not to an expense.
        var billLines = await LinesAsync(c, bill!.Id);
        Assert.Equal(1000m, billLines.Where(l => l.AccountId == c.Account("120100")).Sum(l => l.Debit));
        Assert.DoesNotContain(billLines, l => l.AccountId == c.Account("500100"));
        Assert.Equal((10m, 1000m, 100m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value, (await CostAsync(c)).AverageCost));

        var (invoiceError, invoice) = await InvoiceAsync(c, D2, 4, 236m);
        Assert.Null(invoiceError);
        var invoiceLines = await LinesAsync(c, invoice!.Id);
        Assert.Equal(400m, invoiceLines.Where(l => l.AccountId == c.Account("500100")).Sum(l => l.Debit));
        Assert.Equal(400m, invoiceLines.Where(l => l.AccountId == c.Account("120100")).Sum(l => l.Credit));
        Assert.Equal(invoiceLines.Sum(l => l.Debit), invoiceLines.Sum(l => l.Credit));

        var valuation = await ValuationAsync(c, D3);
        Assert.Equal(600m, valuation.StockValue);
        Assert.Equal(600m, valuation.LedgerValue);
        Assert.Equal(0m, valuation.Difference);

        // The margin report: 4 × 200 net − 400 cost.
        var margin = (MarginReportResponse)Assert.IsType<OkObjectResult>((await Inventory(c).Margin(c.Id, D1, D3)).Result).Value!;
        Assert.Equal((800m, 400m, 400m), (margin.NetSales, margin.Cost, margin.Margin));
    }

    [Fact]
    public async Task SellingMoreThanInStock_IsRefusedUnderBlock_AndNothingIsPosted()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 3, 118m);
        var (error, _) = await InvoiceAsync(c, D2, 5, 236m);
        Assert.IsType<BadRequestObjectResult>(error);
        Assert.Equal(3m, (await CostAsync(c)).Quantity);
        Assert.Equal(1, await c.Db.StockMoves.CountAsync());

        // Under Warn it goes through, and the next receipt corrects cost of goods sold.
        var settings = await c.Db.StockSettings.SingleAsync(s => s.CompanyId == c.Id);
        settings.NegativeStock = NegativeStockPolicy.Warn;
        await c.Db.SaveChangesAsync();
        Assert.Null((await InvoiceAsync(c, D2, 5, 236m)).Error);
        Assert.Equal(-2m, (await CostAsync(c)).Quantity);
        var (_, receipt) = await BillAsync(c, D3, 10, 141.6m); // 120 net: the 2 sold below zero really cost 120, not 100
        var correction = (await LinesAsync(c, receipt!.Id)).Where(l => l.AccountId == c.Account("500100")).Sum(l => l.Debit);
        Assert.Equal(40m, correction);
        Assert.Equal((8m, 960m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);
    }

    [Fact]
    public async Task TwoBillsAverage_AndASalesReturnComesBackAtTheOriginalCost()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);   // 10 @ 100
        var (_, sale) = await InvoiceAsync(c, D1, 5, 236m); // 5 leave at 100
        await BillAsync(c, D2, 5, 236m);    // 5 @ 200 → 10 @ 150
        Assert.Equal(150m, (await CostAsync(c)).AverageCost);

        var (error, returned) = await InvoiceAsync(c, D3, 2, 236m, InvoiceDocumentType.SalesReturn, sale!.Id);
        Assert.Null(error);
        // Back at 100 each (what they cost when sold), not at today's 150.
        var lines = await LinesAsync(c, returned!.Id);
        Assert.Equal(200m, lines.Where(l => l.AccountId == c.Account("120100")).Sum(l => l.Debit));
        Assert.Equal(200m, lines.Where(l => l.AccountId == c.Account("500100")).Sum(l => l.Credit));
        Assert.Equal((12m, 1700m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);
    }

    [Fact]
    public async Task ABackDatedBill_ReplaysLaterSales_AndPostsTheDifferenceOnce()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);              // 10 @ 100
        var (_, sale) = await InvoiceAsync(c, D3, 10, 236m); // all 10 sold at 100 on the 20th
        // A bill dated the 10th, entered late: 10 @ 200. The sale on the 20th now draws from
        // 20 @ 150 → its cost becomes 1,500 instead of 1,000; the bill posts the 500 difference.
        var (error, late) = await BillAsync(c, D2, 10, 236m);
        Assert.Null(error);
        var lines = await LinesAsync(c, late!.Id);
        Assert.Equal(500m, lines.Where(l => l.AccountId == c.Account("500100")).Sum(l => l.Debit));

        var saleMove = await c.Db.StockMoves.AsNoTracking().SingleAsync(m => m.SourceId == sale!.Id);
        Assert.Equal(1500m, saleMove.Value);
        Assert.Equal((10m, 1500m, 150m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value, (await CostAsync(c)).AverageCost));
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);
    }

    [Fact]
    public async Task ABackDatedSale_ThatWouldEmptyStockBeforeALaterSale_IsRefused()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 5, 118m);
        Assert.Null((await InvoiceAsync(c, D3, 5, 236m)).Error);
        // Selling 1 on the 10th would leave the sale on the 20th short.
        Assert.IsType<BadRequestObjectResult>((await InvoiceAsync(c, D2, 1, 236m)).Error);
    }

    [Fact]
    public async Task PurchaseReturns_AndSupplierCreditNotes()
    {
        var c = await SeedAsync();
        var (_, bill) = await BillAsync(c, D1, 10, 118m);
        // Return 2 to the supplier at the price paid.
        Assert.Null((await BillAsync(c, D2, 2, 118m, BillDocumentType.PurchaseReturn, bill!.Id)).Error);
        Assert.Equal((8m, 800m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        // A credit note of 80 net for the remaining 8 lowers their cost to 90.
        Assert.Null((await BillAsync(c, D3, 1, 94.4m, BillDocumentType.CreditNote, bill.Id)).Error);
        Assert.Equal((8m, 720m, 90m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value, (await CostAsync(c)).AverageCost));
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);
    }

    [Fact]
    public async Task StockDocuments_Opening_Transfer_Count_WriteOff()
    {
        var c = await SeedAsync();
        var inventory = Inventory(c);
        var main = (WarehouseResponse)Assert.IsAssignableFrom<ObjectResult>((await inventory.CreateWarehouse(c.Id, new SaveWarehouseRequest("MAIN", "Main", null))).Result).Value!;
        var shop = (WarehouseResponse)Assert.IsAssignableFrom<ObjectResult>((await inventory.CreateWarehouse(c.Id, new SaveWarehouseRequest("SHOP", "Shop", null))).Result).Value!;
        Assert.True(main.IsDefault);

        async Task<StockDocumentResponse> CreateAndPost(SaveStockDocumentRequest request)
        {
            var created = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await Documents(c).Create(c.Id, request)).Result).Value!;
            var posted = await Documents(c).Post(c.Id, created.Id);
            return (StockDocumentResponse)Assert.IsType<OkObjectResult>(posted.Result).Value!;
        }

        // Opening: 20 @ 50, credited to the opening clearing account 390100 (created on demand).
        var opening = await CreateAndPost(new SaveStockDocumentRequest(StockDocumentType.Opening, D1, main.Id,
            new List<StockDocumentLineRequest> { new(c.Laptop, 20, 50m) }));
        Assert.StartsWith("HAP-", opening.Number);
        Assert.Equal(1000m, opening.TotalValue);
        Assert.Equal(1000m, (await LinesAsync(c, opening.Id)).Where(l => l.AccountId == c.Account("390100")).Sum(l => l.Credit));

        // Transfer 5 to the shop: quantities move, value and ledger don't.
        var transfer = await CreateAndPost(new SaveStockDocumentRequest(StockDocumentType.Transfer, D1, main.Id,
            new List<StockDocumentLineRequest> { new(c.Laptop, 5) }, shop.Id));
        Assert.Null(transfer.JournalEntryId);
        var stock = (PaginatedResponse<StockLevelResponse>)Assert.IsType<OkObjectResult>((await inventory.Stock(c.Id)).Result).Value!;
        var row = Assert.Single(stock.Items);
        Assert.Equal(15m, row.Warehouses.Single(w => w.WarehouseId == main.Id).Quantity);
        Assert.Equal(5m, row.Warehouses.Single(w => w.WarehouseId == shop.Id).Quantity);

        // Count in the shop finds 4: one short → Dr 520100 / Cr stock at 50.
        var count = await CreateAndPost(new SaveStockDocumentRequest(StockDocumentType.Count, D2, shop.Id,
            new List<StockDocumentLineRequest> { new(c.Laptop, 4) }));
        Assert.Equal((5m, -1m), (count.Lines[0].BookQuantity!.Value, count.Lines[0].Difference!.Value));
        Assert.Equal(50m, (await LinesAsync(c, count.Id)).Where(l => l.AccountId == c.Account("520100")).Sum(l => l.Debit));

        // Destroying expired goods needs the ATK notice at least 10 days before.
        var draft = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await Documents(c).Create(c.Id,
            new SaveStockDocumentRequest(StockDocumentType.WriteOff, D2, main.Id, new List<StockDocumentLineRequest> { new(c.Laptop, 2) },
                Reason: WriteOffReason.Expired, AtkNoticeDate: D1))).Result).Value!;
        Assert.IsType<BadRequestObjectResult>((await Documents(c).Post(c.Id, draft.Id)).Result);
        var writeOff = await CreateAndPost(new SaveStockDocumentRequest(StockDocumentType.WriteOff, D3, main.Id,
            new List<StockDocumentLineRequest> { new(c.Laptop, 2) }, Reason: WriteOffReason.Expired, AtkNoticeDate: D2));
        Assert.Equal(100m, (await LinesAsync(c, writeOff.Id)).Where(l => l.AccountId == c.Account("520300")).Sum(l => l.Debit));
        Assert.False(writeOff.VatRepaymentDue);

        Assert.Equal((17m, 850m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);

        // The item card shows every move with running totals.
        var card = (ItemCardResponse)Assert.IsType<OkObjectResult>((await inventory.ItemCard(c.Id, c.Laptop)).Result).Value!;
        Assert.Equal(4, card.Rows.Count);
        Assert.Equal(17m, card.ClosingQuantity);
    }

    [Fact]
    public async Task Dashboard_ShowsStockValue_LowStock_AndStockMargin()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        await InvoiceAsync(c, D2, 4, 236m);
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.MinimumStock = 8m;
        await c.Db.SaveChangesAsync();

        var access = CompanyAccessContext.Unrestricted();
        var controller = new DashboardController(c.Db, new DashboardService(c.Db, access, Tax), access, new NullStringLocalizer<ErrorMessages>());
        var result = await controller.Get(c.Id, new DateOnly(2026, 3, 1), new DateOnly(2026, 3, 31), new DateOnly(2026, 2, 1), new DateOnly(2026, 2, 28));
        var r = Assert.IsType<DashboardResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.True(r.Sections.Inventory);
        var value = r.Kpis.Single(k => k.Key == "stockValue");
        Assert.Equal((600m, 0m), (value.Current, value.Previous));
        Assert.Equal(1m, r.Kpis.Single(k => k.Key == "lowStock").Current);
        // 4 × 200 net against 400 cost: a 50% margin.
        Assert.Equal(50m, r.Kpis.Single(k => k.Key == "stockMargin").Current);
        Assert.Equal(600m, Assert.Single(r.StockByItem!).Current);
    }

    [Fact]
    public async Task Warehouses_TheFirstLook_CreatesTheMainWarehouse_AsTheDefault()
    {
        var c = await SeedAsync();
        var list = (List<WarehouseResponse>)Assert.IsType<OkObjectResult>((await Inventory(c).Warehouses(c.Id)).Result).Value!;
        var main = Assert.Single(list);
        Assert.Equal("MAIN", main.Code);
        Assert.True(main.IsDefault);
        // Looking again doesn't add another.
        list = (List<WarehouseResponse>)Assert.IsType<OkObjectResult>((await Inventory(c).Warehouses(c.Id)).Result).Value!;
        Assert.Single(list);
    }

    [Fact]
    public async Task ManualJournalEntries_ToTheStockAccount_AreRefusedWhileItemsTrackStock()
    {
        var c = await SeedAsync();
        var tokens = new ActionTokenService();
        var journal = await c.Db.Journals.AsNoTracking().FirstAsync(j => j.CompanyId == c.Id && j.Type == JournalType.General);
        var controller = new JournalEntriesController(c.Db, new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>(), new ExportLabels(new NullStringLocalizer<ErrorMessages>()));
        As(controller, c.UserId);
        var result = await controller.Create(c.Id, new CreateJournalEntryRequest(journal.Id, D1, null, new List<CreateJournalEntryLineRequest>
        {
            new(c.Account("120100"), null, 50m, 0m, "fix"),
            new(c.Account("303100"), null, 0m, 50m, "fix"),
        }), tokens, tokens.GenerateToken(c.UserId, c.Id, "create-journal-entry").Token);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }
}
