using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Bills;
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
        As(new StockDocumentsController(c.Db, new StockDocumentService(c.Db, Stock(c), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>(), Tax),
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

    // Four sales of 3 race for 10 in stock, each on its own connection: the item-cost row lock
    // serialises them, so exactly three post, the fourth is refused, and nothing goes negative.
    [Fact]
    public async Task ParallelSales_ForTheSameStock_NeverOversell()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        var drafts = new List<Guid>();
        for (var i = 0; i < 4; i++)
        {
            var created = await Invoices(c).Create(c.Id, new CreateInvoiceRequest(c.Customer, D2, D2,
                new List<CreateInvoiceLineRequest> { new("Laptops", 3m, 236m, c.S18, null, null, c.Laptop) }));
            drafts.Add(((InvoiceResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id);
        }

        var results = await Task.WhenAll(drafts.Select(async id =>
        {
            await using var db = PostgresTestDatabase.CreateAdditionalContext(c.Db);
            var controller = As(new InvoicesController(db, Tax, new DocumentNumberService(), new NumberSeriesService(db),
                new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), c.UserId);
            return (await controller.Post(c.Id, id)).Result;
        }));

        Assert.Equal(3, results.Count(r => r is OkObjectResult));
        Assert.Single(results, r => r is BadRequestObjectResult);
        var cost = await CostAsync(c);
        Assert.Equal((1m, 100m), (cost.Quantity, cost.Value));
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);
        // The ledger's running totals end where the item cost does.
        var last = await c.Db.StockMoves.AsNoTracking().Where(m => m.ItemId == c.Laptop).OrderByDescending(m => m.Sequence).FirstAsync();
        Assert.Equal((1m, 100m), (last.QtyAfter, last.ValueAfter));
    }

    [Fact]
    public async Task WriteOffs_KeepTheirAttachments_UnderTheInventoryArea()
    {
        var c = await SeedAsync();
        var main = (await Inventory(c).Warehouses(c.Id)).Result is OkObjectResult ok ? ((List<WarehouseResponse>)ok.Value!)[0] : null;
        var draft = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await Documents(c).Create(c.Id,
            new SaveStockDocumentRequest(StockDocumentType.WriteOff, D1, main!.Id, new List<StockDocumentLineRequest> { new(c.Laptop, 1m) },
                Reason: WriteOffReason.Theft))).Result).Value!;
        var bytes = "%PDF-1.4 police report"u8.ToArray();
        var file = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "File", "police-report.pdf")
        {
            Headers = new HeaderDictionary(), ContentType = "application/pdf",
        };
        var attachments = As(new AttachmentsController(c.Db, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), c.UserId);
        var upload = await attachments.Upload(c.Id, new UploadAttachmentRequest { OwnerType = "StockDocument", OwnerId = draft.Id, File = file });
        Assert.Equal(StatusCodes.Status201Created, Assert.IsAssignableFrom<ObjectResult>(upload.Result).StatusCode);

        var list = (List<AttachmentResponse>)Assert.IsType<OkObjectResult>((await attachments.List(c.Id,
            Pako.Domain.Attachments.AttachmentOwnerType.StockDocument, draft.Id)).Result).Value!;
        Assert.Equal("police-report.pdf", Assert.Single(list).FileName);

        // An id that is no stock document of this company is refused.
        var stray = await attachments.Upload(c.Id, new UploadAttachmentRequest { OwnerType = "StockDocument", OwnerId = Guid.NewGuid(), File = file });
        Assert.IsType<BadRequestObjectResult>(stray.Result);
    }

    [Fact]
    public async Task CountSheet_PrintsAsPdf_AndStockLevels_NameTheUsualSupplier()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 3, 118m);
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.MinimumStock = 5m;
        await c.Db.SaveChangesAsync();
        var main = ((List<WarehouseResponse>)((OkObjectResult)(await Inventory(c).Warehouses(c.Id)).Result!).Value!)[0];

        var pdf = Assert.IsType<FileContentResult>(await Documents(c).CountSheetPdf(c.Id, main.Id, D2));
        Assert.Equal("application/pdf", pdf.ContentType);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf.FileContents, 0, 4));
        Assert.IsType<FileContentResult>(await Documents(c).CountSheetPdf(c.Id, main.Id, D2, blind: true));
        Assert.IsType<NotFoundResult>(await Documents(c).CountSheetPdf(c.Id, Guid.NewGuid(), D2));

        var low = (PaginatedResponse<StockLevelResponse>)Assert.IsType<OkObjectResult>((await Inventory(c).Stock(c.Id, belowMinimum: true)).Result).Value!;
        var row = Assert.Single(low.Items);
        Assert.Equal(("Vendor", 2m), (row.UsualSupplierName, row.ShortBy));
    }

    private async Task<StockDocumentResponse> PostDocumentAsync(Co c, SaveStockDocumentRequest request)
    {
        var created = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await Documents(c).Create(c.Id, request)).Result).Value!;
        return (StockDocumentResponse)Assert.IsType<OkObjectResult>((await Documents(c).Post(c.Id, created.Id)).Result).Value!;
    }

    private async Task<Guid> MainWarehouseAsync(Co c) =>
        ((List<WarehouseResponse>)((OkObjectResult)(await Inventory(c).Warehouses(c.Id)).Result!).Value!).Single(w => w.IsDefault).Id;

    // D14 phase 2: stolen goods lose the input VAT deducted on them, reversed in the write-off's entry
    // with the purchase's tax code so the VAT return shows it.
    [Fact]
    public async Task TheftWriteOff_ReversesTheInputVat_WithThePurchaseTaxCode()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        var main = await MainWarehouseAsync(c);
        var theft = await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.WriteOff, D2, main,
            new List<StockDocumentLineRequest> { new(c.Laptop, 2m) }, Reason: WriteOffReason.Theft));

        Assert.Equal(36m, theft.VatRepaid);
        var lines = await LinesAsync(c, theft.Id);
        var vat = Assert.Single(lines, l => l.TaxId != null);
        Assert.Equal((c.Account("113110"), 36m, c.B18), (vat.AccountId, vat.Credit, vat.TaxId!.Value));
        Assert.Equal(236m, lines.Where(l => l.AccountId == c.Account("520100")).Sum(l => l.Debit));
        Assert.Equal(lines.Sum(l => l.Debit), lines.Sum(l => l.Credit));
        // Input VAT on 113110: 180 deducted on the bill, 36 given back.
        var input = await c.Db.JournalEntryLines.AsNoTracking()
            .Where(l => l.AccountId == c.Account("113110") && l.JournalEntry!.CompanyId == c.Id).SumAsync(l => l.Debit - l.Credit);
        Assert.Equal(144m, input);

        // A damaged-goods write-off keeps the VAT.
        var damaged = await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.WriteOff, D3, main,
            new List<StockDocumentLineRequest> { new(c.Laptop, 1m) }, Reason: WriteOffReason.Damaged, AtkNoticeDate: D1));
        Assert.Null(damaged.VatRepaid);
        // Each write-off gets its own number (the series reads stock_documents, not invoices).
        Assert.Equal(("NJP-0001/2026", "NJP-0002/2026"), (theft.Number, damaged.Number));
        Assert.DoesNotContain(await LinesAsync(c, damaged.Id), l => l.TaxId != null);
    }

    // IAS 2: stock worth less than cost carries an allowance on 120900, raised and released by
    // write-down documents; quantities and the average cost stay as they are.
    [Fact]
    public async Task WriteDowns_RaiseAndReleaseTheAllowance_WithoutMovingStock()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        var main = await MainWarehouseAsync(c);
        var first = await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.WriteDown, D1, main,
            new List<StockDocumentLineRequest> { new(c.Laptop, 0m, 80m) }));
        Assert.StartsWith("ZHV-", first.Number);
        Assert.Equal((10m, 100m, 200m, 200m), (first.Lines[0].BookQuantity!.Value, first.Lines[0].AverageCost!.Value,
            first.Lines[0].AllowanceAfter!.Value, first.TotalValue));
        var lines = await LinesAsync(c, first.Id);
        Assert.Equal(200m, lines.Where(l => l.AccountId == c.Account("520300")).Sum(l => l.Debit));
        Assert.Equal(200m, lines.Where(l => l.AccountId == c.Account("120900")).Sum(l => l.Credit));
        Assert.Equal((10m, 1000m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        var valuation = await ValuationAsync(c, D1);
        Assert.Equal((1000m, 200m, 800m, 0m), (valuation.StockValue, valuation.WriteDownAllowance, valuation.NetValue, valuation.Difference));

        // Half sold, and the rest now worth 90: the allowance falls to 5 × 10 = 50, releasing 150.
        await InvoiceAsync(c, D2, 5, 236m);
        var second = await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.WriteDown, D3, main,
            new List<StockDocumentLineRequest> { new(c.Laptop, 0m, 90m) }));
        Assert.Equal(-150m, second.TotalValue);
        Assert.Equal(150m, (await LinesAsync(c, second.Id)).Where(l => l.AccountId == c.Account("120900")).Sum(l => l.Debit));
        Assert.Equal(50m, (await ValuationAsync(c, D3)).WriteDownAllowance);

        // An earlier-dated write-down would disorder the allowance.
        var created = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await Documents(c).Create(c.Id,
            new SaveStockDocumentRequest(StockDocumentType.WriteDown, D2, main, new List<StockDocumentLineRequest> { new(c.Laptop, 0m, 50m) }))).Result).Value!;
        Assert.IsType<BadRequestObjectResult>((await Documents(c).Post(c.Id, created.Id)).Result);
    }

    [Fact]
    public async Task YearEndCheck_NamesWarehousesWithoutACount()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 4, 118m);
        var main = await MainWarehouseAsync(c);
        var check = (StockYearEndCheckResponse)Assert.IsType<OkObjectResult>((await Inventory(c).YearEndCheck(c.Id, 2026)).Result).Value!;
        Assert.True(check.TracksStock);
        Assert.Single(check.WarehousesWithoutCount);
        Assert.Equal(0m, check.Difference);

        await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.Count, D3, main,
            new List<StockDocumentLineRequest> { new(c.Laptop, 4m) }));
        check = (StockYearEndCheckResponse)Assert.IsType<OkObjectResult>((await Inventory(c).YearEndCheck(c.Id, 2026)).Result).Value!;
        Assert.Empty(check.WarehousesWithoutCount);
        Assert.StartsWith("INVR-", check.Warehouses.Single().LastCountNumber);
        // A year with no stock at all needs nothing.
        Assert.False(((StockYearEndCheckResponse)((OkObjectResult)(await Inventory(c).YearEndCheck(c.Id, 2024)).Result!).Value!).TracksStock);
    }

    private static PriceListsController Prices(Co c) =>
        As(new PriceListsController(c.Db, new PriceListService(c.Db, Stock(c), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()),
            new NullStringLocalizer<ErrorMessages>()), c.UserId);

    private async Task<PriceChangeResponse> PostPriceChangeAsync(Co c, Guid listId, DateOnly date, decimal price)
    {
        var draft = (PriceChangeResponse)Assert.IsAssignableFrom<ObjectResult>((await Prices(c).CreateChange(c.Id,
            new SavePriceChangeRequest(listId, date, new List<PriceChangeLineRequest> { new(c.Laptop, price) }))).Result).Value!;
        return (PriceChangeResponse)Assert.IsType<OkObjectResult>((await Prices(c).PostChange(c.Id, draft.Id)).Result).Value!;
    }

    // §12 P4: the shop's own list wins over the company list, which wins over the item's price; each
    // list's latest price valid on the day applies. A price change (Nivelim) records the old price,
    // the quantity on hand and the shelf difference, and writes no journal entry.
    [Fact]
    public async Task PriceLists_ResolveShopFirst_AndPriceChangesKeepTheShelfRecord()
    {
        var c = await SeedAsync();
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.DefaultUnitPrice = 260m;
        await c.Db.SaveChangesAsync();
        await BillAsync(c, D1, 6, 118m);
        var main = await MainWarehouseAsync(c);

        var company = (PriceListResponse)Assert.IsAssignableFrom<ObjectResult>((await Prices(c).CreateList(c.Id, new SavePriceListRequest("Retail", null))).Result).Value!;
        var shop = (PriceListResponse)Assert.IsAssignableFrom<ObjectResult>((await Prices(c).CreateList(c.Id, new SavePriceListRequest("Main shop", main))).Result).Value!;
        // A second company-wide list is refused.
        Assert.IsType<BadRequestObjectResult>((await Prices(c).CreateList(c.Id, new SavePriceListRequest("Other", null))).Result);

        async Task<ResolvedPriceResponse> Resolve(Guid? warehouse, DateOnly date) =>
            Assert.Single((List<ResolvedPriceResponse>)Assert.IsType<OkObjectResult>(
                (await Prices(c).Resolve(c.Id, new List<Guid> { c.Laptop }, warehouse, date)).Result).Value!);

        Assert.Equal(("item", 260m), ((await Resolve(main, D1)).Source, (await Resolve(main, D1)).Price));
        var first = await PostPriceChangeAsync(c, company.Id, D1, 250m);
        Assert.Equal("NIV-0001/2026", first.Number);
        var shopChange = await PostPriceChangeAsync(c, shop.Id, D2, 240m);
        Assert.Equal("NIV-0002/2026", shopChange.Number);
        // The shop's old price was the company list's 250; 6 on hand, 10 cheaper each.
        var line = Assert.Single(shopChange.Lines);
        Assert.Equal((250m, 6m, -60m), (line.OldPrice!.Value, line.Quantity!.Value, line.Difference!.Value));
        Assert.Equal(-60m, shopChange.TotalDifference);

        Assert.Equal(("company", 250m), ((await Resolve(main, D1)).Source, (await Resolve(main, D1)).Price));
        Assert.Equal(("warehouse", 240m), ((await Resolve(main, D2)).Source, (await Resolve(main, D2)).Price));
        Assert.Equal(("company", 250m), ((await Resolve(null, D3)).Source, (await Resolve(null, D3)).Price));
        Assert.DoesNotContain(await c.Db.JournalEntries.AsNoTracking().Where(e => e.SourceDocumentId == shopChange.Id).ToListAsync(), _ => true);

        // A posted change can't be edited or posted again; the record prints.
        Assert.IsType<BadRequestObjectResult>((await Prices(c).PostChange(c.Id, shopChange.Id)).Result);
        var pdf = Assert.IsType<FileContentResult>(await Prices(c).ChangePdf(c.Id, shopChange.Id));
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf.FileContents, 0, 4));
        var items = (PaginatedResponse<PriceListItemResponse>)Assert.IsType<OkObjectResult>((await Prices(c).Items(c.Id, shop.Id, D3)).Result).Value!;
        var row = items.Items.Single(i => i.ItemId == c.Laptop);
        Assert.Equal((240m, 250m), (row.Price!.Value, row.FallbackPrice!.Value));
    }

    private static PurchaseOrdersController Orders(Co c) =>
        As(new PurchaseOrdersController(c.Db, new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted(), Tax), c.UserId);

    // §12 P5: an order is confirmed (numbered), billed in parts through bill lines that keep the
    // link, and shows what's billed and what's left; it can't be cancelled once billed.
    [Fact]
    public async Task PurchaseOrders_TrackWhatIsBilled_ThroughTheBillLines()
    {
        var c = await SeedAsync();
        var draft = (PurchaseOrderResponse)Assert.IsAssignableFrom<ObjectResult>((await Orders(c).Create(c.Id, new SavePurchaseOrderRequest(
            c.Vendor, D1, D3, new List<PurchaseOrderLineRequest> { new(c.Laptop, "Laptops", 10m, 118m, c.B18) }))).Result).Value!;
        Assert.Null(draft.Number);
        // A customer isn't a vendor.
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Create(c.Id, new SavePurchaseOrderRequest(
            c.Customer, D1, null, new List<PurchaseOrderLineRequest> { new(c.Laptop, "Laptops", 1m, 1m, null) }))).Result);

        // A bill can't point at a draft order.
        var early = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "V-1", D2, D2, new List<CreateBillLineRequest>
            { new("Laptops", 4m, 118m, c.B18, null, null, c.Laptop, draft.Lines[0].Id) }));
        Assert.IsType<BadRequestObjectResult>(early.Result);

        var confirmed = (PurchaseOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Confirm(c.Id, draft.Id)).Result).Value!;
        Assert.Equal(("PO-0001/2026", PurchaseOrderState.Confirmed), (confirmed.Number, confirmed.State));
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Update(c.Id, draft.Id, new SavePurchaseOrderRequest(
            c.Vendor, D1, null, new List<PurchaseOrderLineRequest> { new(c.Laptop, "Laptops", 1m, 1m, null) }))).Result);

        var created = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "V-1", D2, D2, new List<CreateBillLineRequest>
            { new("Laptops", 4m, 118m, c.B18, null, null, c.Laptop, draft.Lines[0].Id) }));
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        Assert.Equal(draft.Lines[0].Id, bill.Lines[0].PurchaseOrderLineId);
        var order = (PurchaseOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Get(c.Id, draft.Id)).Result).Value!;
        Assert.Equal((0m, 4m, 10m, "none"), (order.Lines[0].Billed, order.Lines[0].InDraftBills, order.Lines[0].Remaining, order.Progress));

        await Bills(c).Post(c.Id, bill.Id);
        order = (PurchaseOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Get(c.Id, draft.Id)).Result).Value!;
        Assert.Equal((4m, 6m, "partly"), (order.Lines[0].Billed, order.Lines[0].Remaining, order.Progress));
        Assert.Single(order.Bills);
        // Stock came in through the bill as usual.
        Assert.Equal(4m, (await CostAsync(c)).Quantity);

        Assert.IsType<BadRequestObjectResult>((await Orders(c).Cancel(c.Id, draft.Id)).Result);
        var closed = (PurchaseOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Close(c.Id, draft.Id)).Result).Value!;
        Assert.Equal(PurchaseOrderState.Closed, closed.State);
    }

    [Fact]
    public async Task LowStock_BecomesOneDraftOrderPerUsualSupplier()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 2, 118m);
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.MinimumStock = 5m;
        var mouse = new Item { Id = Guid.NewGuid(), CompanyId = c.Id, Code = 2, Name = "Mouse", Unit = "pc", Type = ItemType.Goods, TrackInventory = true, MinimumStock = 3m };
        c.Db.Items.Add(mouse);
        await c.Db.SaveChangesAsync();

        var result = (LowStockOrdersResponse)Assert.IsType<OkObjectResult>((await Orders(c).FromLowStock(c.Id)).Result).Value!;
        Assert.Equal((2, 1), (result.Items, result.ItemsWithoutSupplier));
        var order = (PurchaseOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Get(c.Id, Assert.Single(result.PurchaseOrderIds))).Result).Value!;
        Assert.Equal((c.Vendor, PurchaseOrderState.Draft), (order.PartnerId, order.State));
        var line = Assert.Single(order.Lines);
        Assert.Equal((c.Laptop, 3m, 118m, c.B18), (line.ItemId!.Value, line.Quantity, line.UnitPrice, line.TaxDefinitionId!.Value));
    }

    private async Task<GrniReportResponse> GrniAsync(Co c, DateOnly asOf) =>
        (GrniReportResponse)Assert.IsType<OkObjectResult>((await Inventory(c).Grni(c.Id, asOf)).Result).Value!;

    // §12 P6: goods counted in on a receipt sit on 120800 until the vendor's bill matches them. The
    // bill then clears 120800 at the receipt cost instead of adding the stock again, and a price gap
    // revalues the stock. 120800 always equals the open receipts.
    [Fact]
    public async Task Receipts_ComeInAgainstGrni_AndTheBillClearsIt()
    {
        var c = await SeedAsync();
        var main = await MainWarehouseAsync(c);
        var receipt = await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.Receipt, D1, main,
            new List<StockDocumentLineRequest> { new(c.Laptop, 10m, 100m) }, PartnerId: c.Vendor));
        Assert.StartsWith("FP-", receipt.Number);
        var lines = await LinesAsync(c, receipt.Id);
        Assert.Equal(1000m, lines.Where(l => l.AccountId == c.Account("120800")).Sum(l => l.Credit));
        Assert.Equal((10m, 1000m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        var grni = await GrniAsync(c, D1);
        Assert.Equal((1000m, 1000m, 0m), (grni.OpenValue, grni.LedgerValue, grni.Difference));

        // The vendor bills 6 at 110 net: 600 clears 120800, the 60 gap goes onto the stock, no new quantity.
        var (_, bill) = await BillAsync(c, D2, 6, 129.8m);
        var billLines = await LinesAsync(c, bill!.Id);
        Assert.Equal(600m, billLines.Where(l => l.AccountId == c.Account("120800")).Sum(l => l.Debit));
        Assert.Equal(billLines.Sum(l => l.Debit), billLines.Sum(l => l.Credit));
        Assert.Equal((10m, 1060m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        grni = await GrniAsync(c, D2);
        var row = Assert.Single(grni.Rows);
        Assert.Equal((6m, 4m, 400m, 0m), (row.Billed, row.Open, row.OpenValue, grni.Difference));
        Assert.Equal(0m, (await ValuationAsync(c, D2)).Difference);

        // The next bill takes the 4 left and brings 2 more in as a normal purchase.
        await BillAsync(c, D3, 6, 118m);
        Assert.Equal((12m, 1260m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        grni = await GrniAsync(c, D3);
        Assert.Empty(grni.Rows);
        Assert.Equal((0m, 0m), (grni.LedgerValue, grni.Difference));
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);
        // As of D1 the receipt was still fully open.
        Assert.Equal(1000m, (await GrniAsync(c, D1)).OpenValue);
    }

    [Fact]
    public async Task PurchaseOrders_ReceiveTheRest_AsADraftReceipt_AtTheNetPrice()
    {
        var c = await SeedAsync();
        await MainWarehouseAsync(c);
        var order = (PurchaseOrderResponse)Assert.IsAssignableFrom<ObjectResult>((await Orders(c).Create(c.Id, new SavePurchaseOrderRequest(
            c.Vendor, D1, null, new List<PurchaseOrderLineRequest> { new(c.Laptop, "Laptops", 5m, 118m, c.B18) }))).Result).Value!;
        await Orders(c).Confirm(c.Id, order.Id);
        var receiptId = (Guid)Assert.IsType<OkObjectResult>((await Orders(c).Receive(c.Id, order.Id)).Result).Value!;
        var draft = (StockDocumentResponse)Assert.IsType<OkObjectResult>((await Documents(c).Get(c.Id, receiptId)).Result).Value!;
        var line = Assert.Single(draft.Lines);
        Assert.Equal((StockDocumentType.Receipt, 5m, 100m, order.Lines[0].Id), (draft.Type, line.Quantity, line.UnitCost!.Value, line.PurchaseOrderLineId!.Value));

        Assert.IsType<OkObjectResult>((await Documents(c).Post(c.Id, receiptId)).Result);
        var after = (PurchaseOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Get(c.Id, order.Id)).Result).Value!;
        Assert.Equal((5m, 0m), (after.Lines[0].Received, after.Lines[0].ToReceive));
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Receive(c.Id, order.Id)).Result);
    }

    // §12 P7: documents can be in the item's purchase or sales unit; stock moves in base units.
    [Fact]
    public async Task Units_BoxesOnTheBill_PiecesInStock()
    {
        var c = await SeedAsync();
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.PurchaseUnit = "kuti";
        laptop.PurchaseUnitFactor = 24m;
        await c.Db.SaveChangesAsync();

        // 2 boxes at 236 gross (200 net) each: 48 pieces worth 400.
        var created = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "V-UOM", D1, D1,
            new List<CreateBillLineRequest> { new("Laptops", 2m, 236m, c.B18, null, null, c.Laptop, UnitName: "kuti") }));
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        Assert.Equal(("kuti", 24m), (bill.Lines[0].UnitName, bill.Lines[0].UnitFactor));
        Assert.IsType<OkObjectResult>((await Bills(c).Post(c.Id, bill.Id)).Result);
        Assert.Equal((48m, 400m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));

        // Sold by the piece (the base unit), as usual.
        await InvoiceAsync(c, D2, 12, 23.6m);
        Assert.Equal((36m, 300m), ((await CostAsync(c)).Quantity, (await CostAsync(c)).Value));
        Assert.Equal(0m, (await ValuationAsync(c, D2)).Difference);

        var unknown = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "V-UOM2", D1, D1,
            new List<CreateBillLineRequest> { new("Laptops", 1m, 236m, c.B18, null, null, c.Laptop, UnitName: "paletë") }));
        Assert.IsType<BadRequestObjectResult>(unknown.Result);
    }

    // §12 P8: lots with expiry dates. Receipts name the lot; sales take the earliest expiry first
    // unless a lot is named; a return goes back to the lot it was sold from. Cost stays per item.
    [Fact]
    public async Task Lots_ReceivedByNumber_SoldEarliestExpiryFirst()
    {
        var c = await SeedAsync();
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.TrackLots = true;
        await c.Db.SaveChangesAsync();

        // A bill without a lot number is refused for a lot-tracked item.
        var noLot = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "V-L0", D1, D1,
            new List<CreateBillLineRequest> { new("Laptops", 5m, 118m, c.B18, null, null, c.Laptop) }));
        var noLotBill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>(noLot.Result).Value!;
        Assert.IsType<BadRequestObjectResult>((await Bills(c).Post(c.Id, noLotBill.Id)).Result);

        async Task Receive(string reference, decimal qty, string lot, DateOnly expiry)
        {
            var created = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, reference, D1, D1,
                new List<CreateBillLineRequest> { new("Laptops", qty, 118m, c.B18, null, null, c.Laptop, LotNumber: lot, ExpiryDate: expiry) }));
            var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
            Assert.IsType<OkObjectResult>((await Bills(c).Post(c.Id, bill.Id)).Result);
        }
        await Receive("V-L1", 5m, "L-LATE", new DateOnly(2027, 6, 30));
        await Receive("V-L2", 4m, "L-SOON", new DateOnly(2026, 12, 31));

        async Task<Dictionary<string, decimal>> OnHandByLot() =>
            ((List<LotStockResponse>)Assert.IsType<OkObjectResult>((await Inventory(c).Lots(c.Id, c.Laptop)).Result).Value!)
                .ToDictionary(l => l.LotNumber, l => l.Quantity);

        // 6 sold: the 4 expiring soonest first, then 2 of the later lot.
        var (_, sale) = await InvoiceAsync(c, D2, 6, 236m);
        Assert.Equal(new Dictionary<string, decimal> { ["L-LATE"] = 3m }, await OnHandByLot());
        var lots = (List<LotStockResponse>)((OkObjectResult)(await Inventory(c).Lots(c.Id, c.Laptop)).Result!).Value!;
        Assert.Equal(300m, lots.Single().Value);

        // 1 comes back: into the lot it left from first (the soon-expiring one).
        await InvoiceAsync(c, D3, 1, 236m, InvoiceDocumentType.SalesReturn, sale!.Id);
        Assert.Equal(new Dictionary<string, decimal> { ["L-LATE"] = 3m, ["L-SOON"] = 1m }, await OnHandByLot());

        // Expiring before 2027: only the soon lot.
        var expiring = (List<LotStockResponse>)((OkObjectResult)(await Inventory(c).Lots(c.Id, expiringBefore: new DateOnly(2027, 1, 1))).Result!).Value!;
        Assert.Equal("L-SOON", Assert.Single(expiring).LotNumber);
        Assert.Equal(4m, (await CostAsync(c)).Quantity);
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);

        // Lot tracking is fixed now that stock has moved.
        var put = await As(new ItemsController(c.Db, new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()), c.UserId)
            .Update(c.Id, c.Laptop, new UpdateItemRequest("Laptop", "pc", ItemType.Goods, TrackInventory: true, TrackLots: false));
        Assert.IsType<BadRequestObjectResult>(put.Result);
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

    // Audit fixes (2026-10-31). Order lines and receipts count pieces; a bill in boxes counts its
    // pieces, and a second receipt for goods already brought in is refused.
    [Fact]
    public async Task PurchaseOrders_CountBillBoxesInPieces_AndNeverReceiveTwice()
    {
        var c = await SeedAsync();
        var main = await MainWarehouseAsync(c);
        var laptop = await c.Db.Items.SingleAsync(i => i.Id == c.Laptop);
        laptop.PurchaseUnit = "kuti";
        laptop.PurchaseUnitFactor = 24m;
        await c.Db.SaveChangesAsync();

        // 48 pieces ordered, received, then billed as 2 boxes.
        var order = (PurchaseOrderResponse)Assert.IsAssignableFrom<ObjectResult>((await Orders(c).Create(c.Id, new SavePurchaseOrderRequest(
            c.Vendor, D1, null, new List<PurchaseOrderLineRequest> { new(c.Laptop, "Laptops", 48m, 118m, c.B18) }))).Result).Value!;
        await Orders(c).Confirm(c.Id, order.Id);
        var receiptId = (Guid)Assert.IsType<OkObjectResult>((await Orders(c).Receive(c.Id, order.Id)).Result).Value!;
        // Pressing "receive" again while the draft waits makes no second draft.
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Receive(c.Id, order.Id)).Result);
        Assert.IsType<OkObjectResult>((await Documents(c).Post(c.Id, receiptId)).Result);
        var created = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "V-BOX", D2, D2, new List<CreateBillLineRequest>
            { new("Laptops", 2m, 2832m, c.B18, null, null, c.Laptop, order.Lines[0].Id, UnitName: "kuti") }));
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        Assert.IsType<OkObjectResult>((await Bills(c).Post(c.Id, bill.Id)).Result);
        var after = (PurchaseOrderResponse)Assert.IsType<OkObjectResult>((await Orders(c).Get(c.Id, order.Id)).Result).Value!;
        Assert.Equal((48m, 0m, 48m, 0m), (after.Lines[0].Received, after.Lines[0].ToReceive, after.Lines[0].Billed, after.Lines[0].Remaining));
        Assert.IsType<BadRequestObjectResult>((await Orders(c).Receive(c.Id, order.Id)).Result);
        Assert.Equal(48m, (await CostAsync(c)).Quantity);

        // A draft receipt waits while the bill brings the 10 in directly: posting it is refused.
        var second = (PurchaseOrderResponse)Assert.IsAssignableFrom<ObjectResult>((await Orders(c).Create(c.Id, new SavePurchaseOrderRequest(
            c.Vendor, D2, null, new List<PurchaseOrderLineRequest> { new(c.Laptop, "Laptops", 10m, 118m, c.B18) }))).Result).Value!;
        await Orders(c).Confirm(c.Id, second.Id);
        var draftId = (Guid)Assert.IsType<OkObjectResult>((await Orders(c).Receive(c.Id, second.Id)).Result).Value!;
        var direct = (BillResponse)Assert.IsAssignableFrom<ObjectResult>((await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "V-DIR", D3, D3,
            new List<CreateBillLineRequest> { new("Laptops", 10m, 118m, c.B18, null, null, c.Laptop, second.Lines[0].Id) }))).Result).Value!;
        Assert.IsType<OkObjectResult>((await Bills(c).Post(c.Id, direct.Id)).Result);
        Assert.IsType<BadRequestObjectResult>((await Documents(c).Post(c.Id, draftId)).Result);
        Assert.Equal(58m, (await CostAsync(c)).Quantity);
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);
    }

    // §5.3: entries that moved stock are undone by documents, never reversed; bill lines without a
    // tracked item can't post to a stock account; an item can't change to a category with another
    // stock account once it has moved; a company that isn't VAT-registered gives back no VAT.
    [Fact]
    public async Task StockAccounts_StayInStepWithTheStockLedger()
    {
        var c = await SeedAsync();
        await BillAsync(c, D1, 10, 118m);
        var (_, invoice) = await InvoiceAsync(c, D2, 1, 236m);
        var entry = await c.Db.JournalEntries.AsNoTracking().FirstAsync(e => e.SourceDocumentId == invoice!.Id);
        var journals = As(new JournalEntriesController(c.Db, new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>(),
            new ExportLabels(new NullStringLocalizer<ErrorMessages>())), c.UserId);
        Assert.IsType<BadRequestObjectResult>((await journals.Reverse(c.Id, entry.Id, new ReverseJournalEntryRequest(D3))).Result);

        var stockLine = await Bills(c).Create(c.Id, new CreateBillRequest(c.Vendor, "V-ACC", D2, D2, new List<CreateBillLineRequest>
            { new("Stock without an item", 1m, 118m, c.B18, c.Account("120100"), null, null) }));
        Assert.IsType<BadRequestObjectResult>(stockLine.Result);

        var category = new ItemCategory { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Other stock", InventoryAccountId = c.Account("120800") };
        c.Db.ItemCategories.Add(category);
        await c.Db.SaveChangesAsync();
        var items = As(new ItemsController(c.Db, new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>()), c.UserId);
        Assert.IsType<BadRequestObjectResult>((await items.Update(c.Id, c.Laptop, new UpdateItemRequest("Laptop", "pc", ItemType.Goods,
            CategoryId: category.Id, TrackInventory: true))).Result);

        var company = await c.Db.Companies.SingleAsync(x => x.Id == c.Id);
        company.IsVatRegistered = false;
        await c.Db.SaveChangesAsync();
        var theft = await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.WriteOff, D3, await MainWarehouseAsync(c),
            new List<StockDocumentLineRequest> { new(c.Laptop, 1m) }, Reason: WriteOffReason.Theft));
        Assert.DoesNotContain(await LinesAsync(c, theft.Id), l => l.TaxId != null);
        Assert.Equal(0m, (await ValuationAsync(c, D3)).Difference);
    }
}
