using System.Security.Claims;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Tests;

public class StockImportTests : IAsyncLifetime
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
        public required Guid WarehouseId { get; init; }
        public required string RevenueCode { get; init; }
        public required string ExpenseCode { get; init; }
        public required string InventoryCode { get; init; }
        public Guid Account(string code) => Db.Accounts.AsNoTracking().Single(a => a.CompanyId == Id && a.Code == code).Id;
    }

    private static T As<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
            }
        };
        return controller;
    }

    private async Task<Co> SeedAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        var userId = Guid.NewGuid();
        var created = await As(new CompaniesController(db, new NullStringLocalizer<ErrorMessages>()), userId)
            .Create(new CreateCompanyRequest("Import Co"));
        var companyId = ((CompanyResponse)Assert.IsAssignableFrom<ObjectResult>(created.Result).Value!).Id;

        // Use seeded account codes from PAKO_COA_v2_seed.csv
        const string revenueCode = "400100";
        const string expenseCode = "500100";
        const string inventoryCode = "120100";

        // Verify they exist
        Assert.True(await db.Accounts.AnyAsync(a => a.CompanyId == companyId && a.Code == revenueCode));
        Assert.True(await db.Accounts.AnyAsync(a => a.CompanyId == companyId && a.Code == expenseCode));
        Assert.True(await db.Accounts.AnyAsync(a => a.CompanyId == companyId && a.Code == inventoryCode));

        // Get default warehouse (created by company creation seed)
        var warehouse = await db.Warehouses.AsNoTracking().FirstOrDefaultAsync(w => w.CompanyId == companyId);
        if (warehouse is null)
        {
            // If no warehouse yet, create one through StockService
            var stock = new StockService(db, new NullStringLocalizer<ErrorMessages>());
            var wh = await stock.DefaultWarehouseAsync(companyId);
            await db.SaveChangesAsync();
            warehouse = wh;
        }

        return new Co
        {
            Db = db, Id = companyId, UserId = userId, WarehouseId = warehouse.Id,
            RevenueCode = revenueCode, ExpenseCode = expenseCode, InventoryCode = inventoryCode,
        };
    }

    private static StockImportService ImportService(Co c) =>
        new(c.Db, new NumberSeriesService(c.Db),
            new StockDocumentService(c.Db, new StockService(c.Db, new NullStringLocalizer<ErrorMessages>()),
                new NumberSeriesService(c.Db), new NullStringLocalizer<ErrorMessages>(), Tax),
            new NullStringLocalizer<ErrorMessages>());

    private static byte[] BuildTestXlsx(IReadOnlyList<IReadOnlyList<object?>> dataRows)
    {
        var headers = new[] { "Name", "Description", "Unit", "Category", "Sale Price",
            "Revenue Account", "Expense Account", "Inventory Account", "VAT Code", "Min Stock",
            "Barcode", "Opening Qty", "Opening Unit Cost", "Purchase Unit", "Purchase Factor",
            "Sales Unit", "Sales Factor" };
        return ExcelExportService.BuildWorkbook("Stock", (IReadOnlyList<string>)headers, dataRows);
    }

    private static MemoryStream ToStream(byte[] bytes) => new(bytes);

    // ---- Template tests ----

    [Fact]
    public void Template_Empty_ReturnsValidXlsx()
    {
        // Template generation only uses _localizer, so null for the other dependencies is safe.
        var service = new StockImportService(null!, null!, null!, new NullStringLocalizer<ErrorMessages>());
        var bytes = service.GenerateTemplate(false, "en");
        Assert.True(bytes.Length > 0);
        using var wb = new XLWorkbook(new MemoryStream(bytes));
        Assert.Equal(2, wb.Worksheets.Count);
        Assert.Equal("Stock", wb.Worksheets.First().Name);
    }

    [Fact]
    public void Template_Filled_ContainsExampleRows()
    {
        var service = new StockImportService(null!, null!, null!, new NullStringLocalizer<ErrorMessages>());
        var bytes = service.GenerateTemplate(true, "en");
        using var wb = new XLWorkbook(new MemoryStream(bytes));
        var sheet = wb.Worksheet("Stock");
        // Header + 3 example rows
        Assert.True(sheet.LastRowUsed()!.RowNumber() >= 4);
    }

    [Fact]
    public void Template_Albanian_UsesAlbanianHeaders()
    {
        var service = new StockImportService(null!, null!, null!, new NullStringLocalizer<ErrorMessages>());
        var bytes = service.GenerateTemplate(false, "sq");
        using var wb = new XLWorkbook(new MemoryStream(bytes));
        var sheet = wb.Worksheet("Stock");
        Assert.Equal("Emri", sheet.Cell(1, 1).GetString());
    }

    // ---- Preview tests ----

    [Fact]
    public async Task Preview_ValidRows_AllReady()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Widget A", null, "pc", null, 10.00m, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
            new object?[] { "Widget B", null, "kg", null, 20.00m, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, null, null, null);
        Assert.Equal(2, result.Summary.Ready);
        Assert.Equal(0, result.Summary.ErrorCount);
    }

    [Fact]
    public async Task Preview_MissingName_Error()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { null, null, "pc", null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, null, null, null);
        Assert.Equal(0, result.Summary.Ready);
        Assert.Equal(1, result.Summary.ErrorCount);
        Assert.Contains(result.Rows[0].Errors, e => e.Contains("Name", StringComparison.OrdinalIgnoreCase)
            || e.Contains("name", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Preview_MissingUnit_Error()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Widget", null, null, null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, null, null, null);
        Assert.Equal(1, result.Summary.ErrorCount);
    }

    [Fact]
    public async Task Preview_DuplicateNames_Error()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Same Name", null, "pc", null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
            new object?[] { "Same Name", null, "pc", null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, null, null, null);
        // Second row should have error
        Assert.Equal("Error", result.Rows[1].Status);
    }

    [Fact]
    public async Task Preview_UnknownAccountCode_Error()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Widget", null, "pc", null, null, "999999", c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, null, null, null);
        Assert.Equal(1, result.Summary.ErrorCount);
        Assert.Contains(result.Rows[0].Errors, e => e.Contains("account", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Preview_NewCategory_ListedAndWarning()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Widget", null, "pc", "New Cat", null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, null, null, null);
        Assert.Contains("New Cat", result.NewCategories);
        Assert.Equal("Warning", result.Rows[0].Status);
    }

    [Fact]
    public async Task Preview_FallbackAccounts_UsedWhenRowOmits()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Widget", null, "pc", null, null, null, null, null, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, c.Account(c.RevenueCode), c.Account(c.ExpenseCode), c.Account(c.InventoryCode));
        Assert.Equal(1, result.Summary.Ready);
    }

    [Fact]
    public async Task Preview_MissingAccountsNoFallback_Error()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Widget", null, "pc", null, null, null, null, null, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, null, null, null);
        Assert.Equal(1, result.Summary.ErrorCount);
    }

    [Fact]
    public async Task Preview_OpeningQtyNoCost_Error()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Widget", null, "pc", null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, 10m, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ParseAndPreviewAsync(stream, xlsx.Length, c.Id, null, null, null);
        Assert.Equal(1, result.Summary.ErrorCount);
        Assert.Contains(result.Rows[0].Errors, e => e.Contains("cost", StringComparison.OrdinalIgnoreCase));
    }

    // ---- Confirm tests ----

    [Fact]
    public async Task Confirm_CreatesItemsAndCategories()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Import Item 1", "Desc", "pc", "New Category", 15.00m, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, 5m, null, null, null, null, null, null, null },
            new object?[] { "Import Item 2", null, "kg", "New Category", null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ConfirmAsync(stream, xlsx.Length, c.Id, c.WarehouseId, new DateOnly(2026, 1, 1),
            null, null, null, c.UserId);

        Assert.Equal(2, result.Created);
        Assert.Equal(0, result.Skipped);
        Assert.Contains("New Category", result.CreatedCategories);
        Assert.Null(result.OpeningDocumentId); // no opening stock

        // Verify items exist
        var items = await c.Db.Items.AsNoTracking().Where(i => i.CompanyId == c.Id && i.Name.StartsWith("Import Item")).ToListAsync();
        Assert.Equal(2, items.Count);
        Assert.All(items, i => Assert.Equal(ItemType.Goods, i.Type));
        Assert.All(items, i => Assert.True(i.TrackInventory));
    }

    [Fact]
    public async Task Confirm_WithOpeningStock_CreatesAndPostsDocument()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Stock Item", null, "pc", null, 100.00m, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, 50m, 25.00m, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ConfirmAsync(stream, xlsx.Length, c.Id, c.WarehouseId, new DateOnly(2026, 1, 1),
            null, null, null, c.UserId);

        Assert.Equal(1, result.Created);
        Assert.NotNull(result.OpeningDocumentId);
        Assert.NotNull(result.OpeningDocumentNumber);

        // Verify the stock document is posted
        var doc = await c.Db.StockDocuments.AsNoTracking()
            .Include(d => d.Lines)
            .FirstAsync(d => d.Id == result.OpeningDocumentId);
        Assert.Equal(StockDocumentState.Posted, doc.State);
        Assert.Equal(StockDocumentType.Opening, doc.Type);
        Assert.Single(doc.Lines);
        Assert.Equal(50m, doc.Lines[0].Quantity);
        Assert.Equal(25.00m, doc.Lines[0].UnitCost);
    }

    [Fact]
    public async Task Confirm_SkipsErrorRows()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Good Item", null, "pc", null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
            new object?[] { null, null, "pc", null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null }, // missing name
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ConfirmAsync(stream, xlsx.Length, c.Id, c.WarehouseId, new DateOnly(2026, 1, 1),
            null, null, null, c.UserId);

        Assert.Equal(1, result.Created);
        Assert.Equal(1, result.Skipped);
    }

    [Fact]
    public async Task Confirm_NoOpeningQty_NoStockDocument()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "No Stock Item", null, "pc", null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ConfirmAsync(stream, xlsx.Length, c.Id, c.WarehouseId, new DateOnly(2026, 1, 1),
            null, null, null, c.UserId);

        Assert.Equal(1, result.Created);
        Assert.Null(result.OpeningDocumentId);
    }

    [Fact]
    public async Task Confirm_WithBarcode_CreatesBarcode()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Barcode Item", null, "pc", null, null, c.RevenueCode, c.ExpenseCode, c.InventoryCode, null, null, "BC123456", null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ConfirmAsync(stream, xlsx.Length, c.Id, c.WarehouseId, new DateOnly(2026, 1, 1),
            null, null, null, c.UserId);

        Assert.Equal(1, result.Created);
        var barcode = await c.Db.ItemBarcodes.AsNoTracking().FirstOrDefaultAsync(b => b.CompanyId == c.Id && b.Barcode == "BC123456");
        Assert.NotNull(barcode);
    }

    [Fact]
    public async Task Confirm_WithFallbackAccounts_CreatesItems()
    {
        var c = await SeedAsync();
        var svc = ImportService(c);
        var xlsx = BuildTestXlsx(new List<IReadOnlyList<object?>>
        {
            new object?[] { "Fallback Item", null, "pc", null, null, null, null, null, null, null, null, null, null, null, null, null, null },
        });
        using var stream = ToStream(xlsx);
        var result = await svc.ConfirmAsync(stream, xlsx.Length, c.Id, c.WarehouseId, new DateOnly(2026, 1, 1),
            c.Account(c.RevenueCode), c.Account(c.ExpenseCode), c.Account(c.InventoryCode), c.UserId);

        Assert.Equal(1, result.Created);
        Assert.Equal(0, result.Skipped);
    }
}
