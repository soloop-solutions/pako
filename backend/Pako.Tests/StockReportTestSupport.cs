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
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

internal sealed class StockCo
{
    public required PakoDbContext Db { get; init; }
    public required Guid Id { get; init; }
    public required Guid UserId { get; init; }
    public required Guid Customer { get; init; }
    public required Guid Vendor { get; init; }
    public required Guid S18 { get; init; }
    public required Guid B18 { get; init; }
    public required Guid Laptop { get; init; }
    public required Guid MainWarehouse { get; init; }
    public Guid ShopWarehouse { get; set; }
    public Guid Account(string code) => Db.Accounts.AsNoTracking().Single(a => a.CompanyId == Id && a.Code == code).Id;
}

internal static class StockReportTestSupport
{
    public static readonly TaxComputationService Tax = new();
    public static readonly DateOnly Mar1 = new(2026, 3, 1), Mar5 = new(2026, 3, 5), Mar10 = new(2026, 3, 10),
        Mar15 = new(2026, 3, 15), Mar20 = new(2026, 3, 20), Mar31 = new(2026, 3, 31);

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

    public static async Task<StockCo> SeedAsync(PakoDbContext db)
    {
        var userId = Guid.NewGuid();
        var created = await As(new CompaniesController(db, new NullStringLocalizer<ErrorMessages>()), userId).Create(new CreateCompanyRequest("Stock Co"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;
        var taxes = await db.TaxDefinitions.AsNoTracking().Where(t => t.CompanyId == companyId).ToListAsync();
        var s18 = taxes.Single(t => t.Code == "S18").Id;

        var customer = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Customer", IsCustomer = true, FiscalNumber = "811000001" };
        var vendor = new Partner { Id = Guid.NewGuid(), CompanyId = companyId, Name = "Vendor", IsVendor = true, FiscalNumber = "811000002" };
        db.Partners.AddRange(customer, vendor);
        var laptop = new Item
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Code = 1, Name = "Laptop", Unit = "pc", Type = ItemType.Goods, TrackInventory = true,
            DefaultUnitPrice = 236m, DefaultTaxDefinitionId = s18,
        };
        db.Items.Add(laptop);
        await db.SaveChangesAsync();

        var shell = new StockCo
        {
            Db = db, Id = companyId, UserId = userId, Customer = customer.Id, Vendor = vendor.Id,
            S18 = s18, B18 = taxes.Single(t => t.Code == "B18").Id, Laptop = laptop.Id, MainWarehouse = Guid.Empty,
        };
        var main = (WarehouseResponse)Assert.IsAssignableFrom<ObjectResult>((await Inventory(shell).CreateWarehouse(companyId, new SaveWarehouseRequest("MAIN", "Main", null))).Result).Value!;
        var shop = (WarehouseResponse)Assert.IsAssignableFrom<ObjectResult>((await Inventory(shell).CreateWarehouse(companyId, new SaveWarehouseRequest("SHOP", "Shop", null))).Result).Value!;
        return new StockCo
        {
            Db = db, Id = companyId, UserId = userId, Customer = customer.Id, Vendor = vendor.Id,
            S18 = s18, B18 = shell.B18, Laptop = laptop.Id, MainWarehouse = main.Id, ShopWarehouse = shop.Id,
        };
    }

    public static async Task<Item> AddItemAsync(StockCo c, int code, string name, decimal? price = null, Guid? categoryId = null, bool withTax = true)
    {
        var item = new Item
        {
            Id = Guid.NewGuid(), CompanyId = c.Id, Code = code, Name = name, Unit = "pc", Type = ItemType.Goods, TrackInventory = true,
            DefaultUnitPrice = price, DefaultTaxDefinitionId = withTax ? c.S18 : null, CategoryId = categoryId,
        };
        c.Db.Items.Add(item);
        await c.Db.SaveChangesAsync();
        return item;
    }

    public static StockService Stock(StockCo c) => new(c.Db, new NullStringLocalizer<ErrorMessages>());

    public static InventoryController Inventory(StockCo c) =>
        As(new InventoryController(c.Db, Stock(c), new NullStringLocalizer<ErrorMessages>(), Tax, CompanyAccessContext.Unrestricted()), c.UserId);

    public static StockDocumentsController Documents(StockCo c) =>
        As(new StockDocumentsController(c.Db, new StockDocumentService(c.Db, Stock(c), new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>(), Tax),
            Stock(c), new NullStringLocalizer<ErrorMessages>()), c.UserId);

    public static PriceListService Prices(PakoDbContext db) =>
        new(db, new StockService(db, new NullStringLocalizer<ErrorMessages>()), new NumberSeriesService(db), new NullStringLocalizer<ErrorMessages>());

    public static StockReportDataService DataService(PakoDbContext db) =>
        new(db, new StockService(db, new NullStringLocalizer<ErrorMessages>()), Prices(db), Tax);

    public static StockMovementsService MovementsService(PakoDbContext db) => new(db, Prices(db), Tax);

    public static ExportLabels Labels() => new(new NullStringLocalizer<ErrorMessages>());

    public static StockMovementsReportController Movements(StockCo c) =>
        new(MovementsService(c.Db), new NullStringLocalizer<ErrorMessages>(), Labels());

    public static async Task<BillResponse> BillAsync(StockCo c, Guid itemId, DateOnly date, decimal qty, decimal grossUnit,
        Pako.Domain.Bills.DocumentType type = Pako.Domain.Bills.DocumentType.Bill, Guid? original = null)
    {
        var bills = As(new BillsController(c.Db, Tax, new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), c.UserId);
        var created = await bills.Create(c.Id, new CreateBillRequest(c.Vendor, $"V-{Guid.NewGuid():N}"[..10], date, date,
            new List<CreateBillLineRequest> { new("Goods", qty, grossUnit, c.B18, null, null, itemId) }, type, original));
        var bill = (BillResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        var posted = await bills.Post(c.Id, bill.Id);
        return (BillResponse)Assert.IsType<OkObjectResult>(posted.Result).Value!;
    }

    public static async Task<InvoiceResponse> InvoiceAsync(StockCo c, Guid itemId, DateOnly date, decimal qty, decimal grossUnit)
    {
        var invoices = As(new InvoicesController(c.Db, Tax, new DocumentNumberService(), new NumberSeriesService(c.Db),
            new NullStringLocalizer<ErrorMessages>(), CompanyAccessContext.Unrestricted()), c.UserId);
        var created = await invoices.Create(c.Id, new CreateInvoiceRequest(c.Customer, date, date,
            new List<CreateInvoiceLineRequest> { new("Goods", qty, grossUnit, c.S18, null, null, itemId) }));
        var invoice = (InvoiceResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!;
        var posted = await invoices.Post(c.Id, invoice.Id);
        return (InvoiceResponse)Assert.IsType<OkObjectResult>(posted.Result).Value!;
    }

    public static async Task<StockDocumentResponse> PostDocumentAsync(StockCo c, SaveStockDocumentRequest request)
    {
        var created = (StockDocumentResponse)Assert.IsAssignableFrom<ObjectResult>((await Documents(c).Create(c.Id, request)).Result).Value!;
        return (StockDocumentResponse)Assert.IsType<OkObjectResult>((await Documents(c).Post(c.Id, created.Id)).Result).Value!;
    }

    public static async Task<StockValuationResponse> ValuationAsync(StockCo c, DateOnly asOf) =>
        (StockValuationResponse)Assert.IsType<OkObjectResult>((await Inventory(c).Valuation(c.Id, asOf)).Result).Value!;

    public static async Task<StockMovementsReportResponse> ReportAsync(StockCo c, DateOnly from, DateOnly to, string? search = null,
        Guid? categoryId = null, Guid? warehouseId = null, int page = 1, int pageSize = 50, string? sort = null) =>
        (StockMovementsReportResponse)Assert.IsType<OkObjectResult>((await Movements(c).Movements(c.Id, from, to, search, categoryId, warehouseId, page, pageSize, sort)).Result).Value!;

    public static async Task<StockCo> ScenarioAsync(PakoDbContext db)
    {
        var c = await SeedAsync(db);
        await BillAsync(c, c.Laptop, Mar1, 10, 118m);
        await BillAsync(c, c.Laptop, Mar10, 10, 236m);
        await InvoiceAsync(c, c.Laptop, Mar15, 4, 354m);
        await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.Count, Mar20, c.MainWarehouse,
            new List<StockDocumentLineRequest> { new(c.Laptop, 15) }));
        return c;
    }

    public static void AssertGatedOnInventory(Type controller)
    {
        var actions = controller.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes(typeof(Microsoft.AspNetCore.Mvc.Routing.HttpMethodAttribute), true).Length > 0)
            .ToList();
        Assert.NotEmpty(actions);
        foreach (var action in actions)
        {
            var attribute = (RequireCompanyAccessAttribute?)Attribute.GetCustomAttribute(action, typeof(RequireCompanyAccessAttribute));
            Assert.True(attribute is not null, $"{controller.Name}.{action.Name} has no [RequireCompanyAccess].");
            Assert.Equal(Pako.Domain.Hr.AccessModule.Inventory, attribute!.Arguments![2]);
            Assert.Equal(false, attribute.Arguments[0]);
        }
    }
}
