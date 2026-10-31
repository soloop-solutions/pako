using System.Globalization;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Pako.Api.Contracts;
using Pako.Infrastructure;
using static Pako.Tests.StockReportTestSupport;

namespace Pako.Tests;

public class StockReportExportsTests : IAsyncLifetime
{
    private readonly List<PakoDbContext> _contexts = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var db in _contexts) await db.DisposeAsync();
    }

    private async Task<StockCo> ScenarioAsync()
    {
        var db = await PostgresTestDatabase.CreateAsync();
        _contexts.Add(db);
        return await StockReportTestSupport.ScenarioAsync(db);
    }

    private static async Task<(FileContentResult File, IXLWorksheet Sheet)> RunAsync(string culture, Func<Task<IActionResult>> action)
    {
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = new CultureInfo(culture);
        try
        {
            var file = Assert.IsType<FileContentResult>(await action());
            return (file, new XLWorkbook(new MemoryStream(file.FileContents)).Worksheet(1));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }
    }

    private static string[] Row(IXLWorksheet sheet, int row, int count) =>
        Enumerable.Range(1, count).Select(col => sheet.Cell(row, col).GetString()).ToArray();

    private static Pako.Api.Controllers.StockReportExportsController Exports(StockCo c) => new(DataService(c.Db), Labels());

    private static string Json(object value) => JsonSerializer.Serialize(value);

    [Fact]
    public void EveryExportAction_IsGatedOnTheInventoryModule_LikeTheExistingStockReports() =>
        AssertGatedOnInventory(typeof(Pako.Api.Controllers.StockReportExportsController));

    [Fact]
    public async Task MovementsExport_HeadersFollowTheSample_InAlbanianAndEnglish()
    {
        var c = await ScenarioAsync();

        var (_, sq) = await RunAsync("sq", () => Movements(c).MovementsExport(c.Id, Mar5, Mar31));
        Assert.Equal(new[]
        {
            "Shifra", "Emërtimi", "Njësia", "Sasia fillestare", "Vlera fillestare", "Sasia hyrëse", "Vlera hyrëse", "Sasia dalëse",
            "Vlera dalëse", "Sasia përfundimtare", "Çmimi mesatar", "Vlera përfundimtare", "Çmimi i shitjes", "Marzha %",
        }, Row(sq, 1, 14));
        Assert.Equal("Lëvizja e stokut", sq.Name);

        var (_, en) = await RunAsync("en", () => Movements(c).MovementsExport(c.Id, Mar5, Mar31));
        Assert.Equal("Opening quantity", en.Cell(1, 4).GetString());
        Assert.Equal("Stock Movements", en.Name);
        Assert.DoesNotContain(en.CellsUsed(), x => x.GetString().StartsWith("Export_", StringComparison.Ordinal));
        Assert.DoesNotContain(sq.CellsUsed(), x => x.GetString().StartsWith("Export_", StringComparison.Ordinal));
    }

    [Fact]
    public async Task MovementsExport_HasTypedNumericCells_ATotalRow_AndThePeriodInTheFileName()
    {
        var c = await ScenarioAsync();

        var (file, sheet) = await RunAsync("en", () => Movements(c).MovementsExport(c.Id, Mar5, Mar31));

        Assert.Equal("stock-movements-2026-03-05-2026-03-31.xlsx", file.FileDownloadName);
        Assert.Equal(1, sheet.Cell(2, 1).GetDouble());
        Assert.Equal(XLDataType.Number, sheet.Cell(2, 1).DataType);
        Assert.Equal("Laptop", sheet.Cell(2, 2).GetString());
        foreach (var col in Enumerable.Range(4, 11)) Assert.Equal(XLDataType.Number, sheet.Cell(2, col).DataType);
        Assert.Equal(10d, sheet.Cell(2, 4).GetDouble());
        Assert.Equal(1000d, sheet.Cell(2, 5).GetDouble());
        Assert.Equal(2250d, sheet.Cell(2, 12).GetDouble());
        Assert.Equal(200d, sheet.Cell(2, 13).GetDouble());
        Assert.Equal(33.33d, sheet.Cell(2, 14).GetDouble());

        Assert.Equal("Total", sheet.Cell(3, 2).GetString());
        Assert.Equal((1000d, 2000d, 750d, 2250d),
            (sheet.Cell(3, 5).GetDouble(), sheet.Cell(3, 7).GetDouble(), sheet.Cell(3, 9).GetDouble(), sheet.Cell(3, 12).GetDouble()));

        var (_, sq) = await RunAsync("sq", () => Movements(c).MovementsExport(c.Id, Mar5, Mar31));
        Assert.Equal("Gjithsejt", sq.Cell(3, 2).GetString());
    }

    [Fact]
    public async Task MovementsExport_IgnoresPaging_AndCarriesAllFilteredRows()
    {
        var c = await ScenarioAsync();
        var mouse = await AddItemAsync(c, 2, "Mouse");
        var cable = await AddItemAsync(c, 3, "Cable");
        await BillAsync(c, mouse.Id, Mar10, 3, 59m);
        await BillAsync(c, cable.Id, Mar10, 2, 118m);

        var (_, sheet) = await RunAsync("en", () => Movements(c).MovementsExport(c.Id, Mar5, Mar31));

        Assert.Equal(5, sheet.LastRowUsed()!.RowNumber());
        Assert.Equal("Total", sheet.Cell(5, 2).GetString());
        Assert.Equal(2600d, sheet.Cell(5, 12).GetDouble());

        var (_, filtered) = await RunAsync("en", () => Movements(c).MovementsExport(c.Id, Mar5, Mar31, "mou"));
        Assert.Equal(3, filtered.LastRowUsed()!.RowNumber());
    }

    [Fact]
    public async Task LevelsExport_EqualsTheJsonStockLevels_AndCarriesSellPriceAndMarkup()
    {
        var c = await ScenarioAsync();
        var mouse = await AddItemAsync(c, 2, "Mouse");
        await BillAsync(c, mouse.Id, Mar10, 3, 59m);

        var json = (PaginatedResponse<StockLevelResponse>)Assert.IsType<OkObjectResult>((await Inventory(c).Stock(c.Id)).Result).Value!;
        var (file, sheet) = await RunAsync("sq", () => Exports(c).LevelsExport(c.Id));

        Assert.StartsWith("stock-levels-", file.FileDownloadName);
        Assert.Equal(new[] { "Shifra", "Emërtimi", "Grupi", "Njësia", "Sasia", "Çmimi mesatar", "Vlera", "Stoku minimal", "Çmimi i shitjes", "Marzha %" }, Row(sheet, 1, 10));
        Assert.Equal("Gjendja e artikujve", sheet.Name);
        for (var i = 0; i < json.Items.Count; i++)
        {
            var r = json.Items[i];
            Assert.Equal(r.ItemCode, (int)sheet.Cell(i + 2, 1).GetDouble());
            Assert.Equal(r.ItemName, sheet.Cell(i + 2, 2).GetString());
            Assert.Equal((double)r.Quantity, sheet.Cell(i + 2, 5).GetDouble());
            Assert.Equal((double)r.AverageCost, sheet.Cell(i + 2, 6).GetDouble());
            Assert.Equal((double)r.Value, sheet.Cell(i + 2, 7).GetDouble());
        }
        Assert.Equal(200d, sheet.Cell(2, 9).GetDouble());
        Assert.Equal(33.33d, sheet.Cell(2, 10).GetDouble());
        Assert.True(sheet.Cell(3, 9).IsEmpty());
        Assert.Equal("Gjithsejt", sheet.Cell(4, 2).GetString());
        Assert.Equal((double)json.Items.Sum(i => i.Value), sheet.Cell(4, 7).GetDouble());
    }

    [Fact]
    public async Task LevelsExport_FiltersByWarehouse_LikeTheJsonEndpoint()
    {
        var c = await ScenarioAsync();
        await PostDocumentAsync(c, new Pako.Api.Contracts.SaveStockDocumentRequest(Pako.Domain.Inventory.StockDocumentType.Transfer, Mar20, c.MainWarehouse,
            new List<Pako.Api.Contracts.StockDocumentLineRequest> { new(c.Laptop, 5) }, c.ShopWarehouse));

        var json = (PaginatedResponse<StockLevelResponse>)Assert.IsType<OkObjectResult>((await Inventory(c).Stock(c.Id, warehouseId: c.ShopWarehouse)).Result).Value!;
        var (_, sheet) = await RunAsync("en", () => Exports(c).LevelsExport(c.Id, warehouseId: c.ShopWarehouse));

        var row = Assert.Single(json.Items);
        Assert.Equal(5m, row.Quantity);
        Assert.Equal((double)row.Quantity, sheet.Cell(2, 5).GetDouble());
        Assert.Equal((double)row.Value, sheet.Cell(2, 7).GetDouble());
    }

    [Fact]
    public async Task ValuationExport_ItemsAndTheLedgerTieOutBlock_EqualTheJsonValuation()
    {
        var c = await ScenarioAsync();
        var json = await ValuationAsync(c, Mar31);

        var (file, sheet) = await RunAsync("en", () => Exports(c).ValuationExport(c.Id, Mar31));

        Assert.Equal("stock-valuation-2026-03-31.xlsx", file.FileDownloadName);
        Assert.Equal("Stock Valuation", sheet.Name);
        Assert.Equal("Stock value", sheet.Cell(2, 1).GetString());
        Assert.Equal((double)json.StockValue, sheet.Cell(2, 2).GetDouble());
        Assert.Equal((double)json.LedgerValue, sheet.Cell(3, 2).GetDouble());
        Assert.Equal((double)json.Difference, sheet.Cell(4, 2).GetDouble());
        Assert.Equal(0d, sheet.Cell(4, 2).GetDouble());
        Assert.Equal(new[] { "Code", "Name", "Unit", "Quantity", "Average cost", "Value" }, Row(sheet, 6, 6));
        var item = Assert.Single(json.Items);
        Assert.Equal((double)item.Quantity, sheet.Cell(7, 4).GetDouble());
        Assert.Equal((double)item.AverageCost, sheet.Cell(7, 5).GetDouble());
        Assert.Equal((double)item.Value, sheet.Cell(7, 6).GetDouble());
        Assert.Equal((double)json.StockValue, sheet.Cell(8, 6).GetDouble());

        var (_, sq) = await RunAsync("sq", () => Exports(c).ValuationExport(c.Id, Mar31));
        Assert.Equal("Vlerësimi i stokut", sq.Name);
        Assert.Equal("Vlera e stokut", sq.Cell(2, 1).GetString());
        Assert.Equal("Diferenca", sq.Cell(4, 1).GetString());
    }

    [Fact]
    public async Task ItemCardExport_RowsEqualTheJsonCard_WithRunningTotalsAndTranslatedKinds()
    {
        var c = await ScenarioAsync();
        var json = (ItemCardResponse)Assert.IsType<OkObjectResult>((await Inventory(c).ItemCard(c.Id, c.Laptop, Mar5, Mar31)).Result).Value!;

        var (file, sheet) = await RunAsync("sq", () => Exports(c).ItemCardExport(c.Id, c.Laptop, Mar5, Mar31));

        Assert.Equal("item-card-1-2026-03-05-2026-03-31.xlsx", file.FileDownloadName);
        Assert.Equal("Kartela e artikullit", sheet.Name);
        Assert.Equal((double)json.OpeningQuantity, sheet.Cell(6, 2).GetDouble());
        Assert.Equal((double)json.OpeningValue, sheet.Cell(7, 2).GetDouble());
        Assert.Equal((double)json.ClosingQuantity, sheet.Cell(8, 2).GetDouble());
        Assert.Equal((double)json.ClosingValue, sheet.Cell(9, 2).GetDouble());
        var headerRow = 11;
        Assert.Equal("Data", sheet.Cell(headerRow, 1).GetString());
        Assert.Equal("Lloji i lëvizjes", sheet.Cell(headerRow, 2).GetString());
        Assert.Equal(json.Rows.Count, sheet.LastRowUsed()!.RowNumber() - headerRow);
        for (var i = 0; i < json.Rows.Count; i++)
        {
            var r = json.Rows[i];
            var row = headerRow + 1 + i;
            Assert.Equal(XLDataType.DateTime, sheet.Cell(row, 1).DataType);
            Assert.Equal((double)r.QuantityIn, sheet.Cell(row, 7).GetDouble());
            Assert.Equal((double)r.QuantityOut, sheet.Cell(row, 8).GetDouble());
            Assert.Equal((double)r.QtyAfter, sheet.Cell(row, 11).GetDouble());
            Assert.Equal((double)r.ValueAfter, sheet.Cell(row, 13).GetDouble());
        }
        Assert.Equal(new[] { "Hyrje", "Dalje", "Dalje" }, Enumerable.Range(headerRow + 1, 3).Select(r => sheet.Cell(r, 2).GetString()));
        Assert.Equal("Fatura e blerjes", sheet.Cell(headerRow + 1, 3).GetString());
        Assert.Equal("Fatura e shitjes", sheet.Cell(headerRow + 2, 3).GetString());
        Assert.Equal("Dokument stoku", sheet.Cell(headerRow + 3, 3).GetString());

        var (_, en) = await RunAsync("en", () => Exports(c).ItemCardExport(c.Id, c.Laptop, Mar5, Mar31));
        Assert.Equal("Receipt", en.Cell(headerRow + 1, 2).GetString());
    }

    [Fact]
    public async Task ItemCardExport_UnknownItem_Is404()
    {
        var c = await ScenarioAsync();

        Assert.IsType<NotFoundResult>(await Exports(c).ItemCardExport(c.Id, Guid.NewGuid()));
    }

    [Fact]
    public async Task TheDataService_ReturnsTheSameFiguresAsTheJsonEndpoints()
    {
        var c = await ScenarioAsync();
        var data = DataService(c.Db);

        Assert.Equal(Json(await ValuationAsync(c, Mar31)), Json(await data.ValuationAsync(c.Id, Mar31)));
        var card = Assert.IsType<OkObjectResult>((await Inventory(c).ItemCard(c.Id, c.Laptop, Mar5, Mar31)).Result).Value!;
        Assert.Equal(Json(card), Json((await data.CardAsync(c.Id, c.Laptop, Mar5, Mar31))!));
    }
}
