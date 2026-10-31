using Microsoft.AspNetCore.Mvc;
using Pako.Api.Contracts;
using Pako.Api.Controllers;
using Pako.Domain.Inventory;
using Pako.Domain.Reporting;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using static Pako.Tests.StockReportTestSupport;

namespace Pako.Tests;

public class StockMovementsCalculatorTests
{
    [Fact]
    public void Calculate_AddsReceiptsAndRevaluationsIn_IssuesOut_AndIgnoresTransfers()
    {
        var figures = StockMovementsCalculator.Calculate(10m, 1000m, new[]
        {
            new StockMovementInput(StockMoveKind.Receipt, 10m, 2000m),
            new StockMovementInput(StockMoveKind.Issue, 4m, -600m),
            new StockMovementInput(StockMoveKind.Transfer, 5m, 0m),
            new StockMovementInput(StockMoveKind.Revaluation, 0m, -100m),
            new StockMovementInput(StockMoveKind.Revaluation, 0m, 40m),
        });

        Assert.Equal((10m, 2040m, 4m, 700m), (figures.InQuantity, figures.InValue, figures.OutQuantity, figures.OutValue));
        Assert.Equal((16m, 2340m), (figures.ClosingQuantity, figures.ClosingValue));
    }

    [Fact]
    public void MarkupPercent_IsSellOverCostMinusOne_RoundedTo2dp_AndNullWithoutCostOrPrice()
    {
        Assert.Equal(33.33m, StockMovementsCalculator.MarkupPercent(200m, 150m));
        Assert.Equal(-50m, StockMovementsCalculator.MarkupPercent(50m, 100m));
        Assert.Null(StockMovementsCalculator.MarkupPercent(200m, 0m));
        Assert.Null(StockMovementsCalculator.MarkupPercent(null, 150m));
    }

    [Fact]
    public void NetSellPrice_BacksVatOutOfTheGrossPrice_AndLeavesAnUntaxedPriceAlone()
    {
        var vat18 = new TaxDefinition { Rate = 0.18m };
        Assert.Equal(200m, StockMovementsCalculator.NetSellPrice(236m, vat18, new TaxComputationService()));
        Assert.Equal(236m, StockMovementsCalculator.NetSellPrice(236m, null, new TaxComputationService()));
        Assert.Null(StockMovementsCalculator.NetSellPrice(null, vat18, new TaxComputationService()));
    }

    [Fact]
    public void Totals_SumTheValueColumns()
    {
        var totals = StockMovementsCalculator.Totals(new[] { (1m, 2m, 3m, 4m), (10m, 20m, 30m, 40m) });
        Assert.Equal((11m, 22m, 33m, 44m), (totals.OpeningValue, totals.InValue, totals.OutValue, totals.ClosingValue));
    }
}

public class StockMovementsReportTests : IAsyncLifetime
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

    [Fact]
    public async Task Movements_OpeningInOutClosing_OverAPeriodWithPurchaseSaleAndCount_AndClosingEqualsValuationAtTo()
    {
        var c = await ScenarioAsync(await NewDbAsync());

        var report = await ReportAsync(c, Mar5, Mar31);

        var row = Assert.Single(report.Items);
        Assert.Equal((1, "Laptop", "pc"), (row.ItemCode, row.ItemName, row.Unit));
        Assert.Equal((10m, 1000m), (row.OpeningQuantity, row.OpeningValue));
        Assert.Equal((10m, 2000m), (row.InQuantity, row.InValue));
        Assert.Equal((5m, 750m), (row.OutQuantity, row.OutValue));
        Assert.Equal((15m, 150m, 2250m), (row.ClosingQuantity, row.AverageCost, row.ClosingValue));
        Assert.Equal((1000m, 2000m, 750m, 2250m),
            (report.TotalOpeningValue, report.TotalInValue, report.TotalOutValue, report.TotalClosingValue));
        Assert.Equal((Mar5, Mar31, 1, 1, 50), (report.From, report.To, report.Total, report.Page, report.PageSize));

        var valuation = await ValuationAsync(c, Mar31);
        var valued = Assert.Single(valuation.Items);
        Assert.Equal((valued.Quantity, valued.Value, valued.AverageCost), (row.ClosingQuantity, row.ClosingValue, row.AverageCost));
        Assert.Equal(valuation.StockValue, report.TotalClosingValue);
    }

    [Fact]
    public async Task Movements_AClosingBeforeTheLaterMoves_StopsAtTheToDate()
    {
        var c = await ScenarioAsync(await NewDbAsync());

        var report = await ReportAsync(c, Mar5, Mar15);

        var row = Assert.Single(report.Items);
        Assert.Equal((10m, 2000m, 4m, 600m), (row.InQuantity, row.InValue, row.OutQuantity, row.OutValue));
        Assert.Equal((16m, 2400m), (row.ClosingQuantity, row.ClosingValue));
        Assert.Equal(2400m, (await ValuationAsync(c, Mar15)).StockValue);
    }

    [Fact]
    public async Task Movements_AfterABackDatedBillReplaysALaterSale_ClosingStillEqualsValuation()
    {
        var c = await SeedAsync(await NewDbAsync());
        await BillAsync(c, c.Laptop, Mar1, 10, 118m);
        await InvoiceAsync(c, c.Laptop, Mar20, 10, 236m);
        await BillAsync(c, c.Laptop, Mar10, 10, 236m);

        var report = await ReportAsync(c, Mar5, Mar31);

        var row = Assert.Single(report.Items);
        Assert.Equal((10m, 1000m), (row.OpeningQuantity, row.OpeningValue));
        Assert.Equal((10m, 2000m), (row.InQuantity, row.InValue));
        Assert.Equal((10m, 1500m), (row.OutQuantity, row.OutValue));
        Assert.Equal((10m, 1500m), (row.ClosingQuantity, row.ClosingValue));
        var valuation = await ValuationAsync(c, Mar31);
        Assert.Equal(valuation.StockValue, report.TotalClosingValue);
    }

    [Fact]
    public async Task Movements_Item_WithOpeningButNoMovement_IsListed_AndAnItemNeverMoved_IsNot()
    {
        var c = await ScenarioAsync(await NewDbAsync());
        var mouse = await AddItemAsync(c, 2, "Mouse");
        await BillAsync(c, mouse.Id, Mar1, 3, 59m);
        await AddItemAsync(c, 3, "Keyboard");

        var report = await ReportAsync(c, Mar5, Mar31);

        Assert.Equal(new[] { 1, 2 }, report.Items.Select(r => r.ItemCode));
        var row = report.Items.Single(r => r.ItemCode == 2);
        Assert.Equal((3m, 150m, 0m, 0m, 3m, 150m), (row.OpeningQuantity, row.OpeningValue, row.InQuantity, row.OutQuantity, row.ClosingQuantity, row.ClosingValue));
    }

    [Fact]
    public async Task Movements_MarkupUsesTheNetSellPrice_AtTheItemsVatRate_AndIsNullWithoutAPrice()
    {
        var c = await ScenarioAsync(await NewDbAsync());
        var mouse = await AddItemAsync(c, 2, "Mouse");
        await BillAsync(c, mouse.Id, Mar10, 3, 59m);
        var untaxed = await AddItemAsync(c, 3, "Cable", price: 100m, withTax: false);
        await BillAsync(c, untaxed.Id, Mar10, 2, 59m);

        var report = await ReportAsync(c, Mar5, Mar31);

        var laptop = report.Items.Single(r => r.ItemCode == 1);
        Assert.Equal((200m, 33.33m), (laptop.SellPriceExVat, laptop.MarkupPercent));
        var noPrice = report.Items.Single(r => r.ItemCode == 2);
        Assert.Null(noPrice.SellPriceExVat);
        Assert.Null(noPrice.MarkupPercent);
        var cable = report.Items.Single(r => r.ItemCode == 3);
        Assert.Equal((100m, 100m), (cable.SellPriceExVat, cable.MarkupPercent));
    }

    [Fact]
    public async Task Movements_ACompanyWidePriceList_OverridesTheItemsDefaultPrice()
    {
        var c = await ScenarioAsync(await NewDbAsync());
        var list = new PriceList { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Retail" };
        c.Db.PriceLists.Add(list);
        var change = new PriceChange { Id = Guid.NewGuid(), CompanyId = c.Id, PriceListId = list.Id, State = PriceChangeState.Posted, Date = Mar1 };
        c.Db.PriceChanges.Add(change);
        c.Db.PriceListPrices.Add(new PriceListPrice { Id = Guid.NewGuid(), PriceListId = list.Id, ItemId = c.Laptop, Price = 354m, ValidFrom = Mar1, PriceChangeId = change.Id });
        await c.Db.SaveChangesAsync();

        var row = Assert.Single((await ReportAsync(c, Mar5, Mar31)).Items);

        Assert.Equal((300m, 100m), (row.SellPriceExVat, row.MarkupPercent));
    }

    [Fact]
    public async Task Movements_InternalTransfers_AreNeitherInNorOut_CompanyWide_ButMoveBetweenWarehouses()
    {
        var c = await SeedAsync(await NewDbAsync());
        await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.Opening, Mar1, c.MainWarehouse,
            new List<StockDocumentLineRequest> { new(c.Laptop, 20, 50m) }));
        await PostDocumentAsync(c, new SaveStockDocumentRequest(StockDocumentType.Transfer, Mar10, c.MainWarehouse,
            new List<StockDocumentLineRequest> { new(c.Laptop, 5) }, c.ShopWarehouse));

        var company = Assert.Single((await ReportAsync(c, Mar5, Mar31)).Items);
        Assert.Equal((20m, 1000m, 0m, 0m, 0m, 0m, 20m, 1000m),
            (company.OpeningQuantity, company.OpeningValue, company.InQuantity, company.InValue, company.OutQuantity, company.OutValue, company.ClosingQuantity, company.ClosingValue));

        var shop = Assert.Single((await ReportAsync(c, Mar5, Mar31, warehouseId: c.ShopWarehouse)).Items);
        Assert.Equal((0m, 5m, 250m, 0m, 5m, 250m), (shop.OpeningQuantity, shop.InQuantity, shop.InValue, shop.OutQuantity, shop.ClosingQuantity, shop.ClosingValue));
        var main = Assert.Single((await ReportAsync(c, Mar5, Mar31, warehouseId: c.MainWarehouse)).Items);
        Assert.Equal((20m, 1000m, 0m, 5m, 250m, 15m, 750m),
            (main.OpeningQuantity, main.OpeningValue, main.InQuantity, main.OutQuantity, main.OutValue, main.ClosingQuantity, main.ClosingValue));
    }

    [Fact]
    public async Task Movements_PagesWithTotalsOverTheWholeFilteredSet_SearchAndCategoryFilter()
    {
        var c = await ScenarioAsync(await NewDbAsync());
        var category = new ItemCategory { Id = Guid.NewGuid(), CompanyId = c.Id, Name = "Peripherals" };
        c.Db.ItemCategories.Add(category);
        await c.Db.SaveChangesAsync();
        var mouse = await AddItemAsync(c, 2, "Mouse", categoryId: category.Id);
        var cable = await AddItemAsync(c, 3, "Cable", categoryId: category.Id);
        await BillAsync(c, mouse.Id, Mar10, 3, 59m);
        await BillAsync(c, cable.Id, Mar10, 2, 118m);

        var all = await ReportAsync(c, Mar5, Mar31);
        var pageOne = await ReportAsync(c, Mar5, Mar31, page: 1, pageSize: 2);
        var pageTwo = await ReportAsync(c, Mar5, Mar31, page: 2, pageSize: 2);

        Assert.Equal((3, 2, 2), (pageOne.Total, pageOne.Items.Count, pageOne.PageSize));
        Assert.Equal(new[] { 3 }, pageTwo.Items.Select(r => r.ItemCode));
        Assert.Equal(all.TotalClosingValue, pageOne.TotalClosingValue);
        Assert.Equal(all.TotalClosingValue, pageTwo.TotalClosingValue);
        Assert.Equal(2250m + 150m + 200m, all.TotalClosingValue);
        Assert.Equal(all.TotalInValue, pageTwo.TotalInValue);

        var peripherals = await ReportAsync(c, Mar5, Mar31, categoryId: category.Id, pageSize: 1);
        Assert.Equal((2, 1, "Peripherals"), (peripherals.Total, peripherals.Items.Count, peripherals.Items[0].CategoryName));
        Assert.Equal(350m, peripherals.TotalClosingValue);

        var found = await ReportAsync(c, Mar5, Mar31, search: "mou");
        Assert.Equal(new[] { 2 }, found.Items.Select(r => r.ItemCode));
        var byName = await ReportAsync(c, Mar5, Mar31, sort: "-name");
        Assert.Equal(new[] { "Mouse", "Laptop", "Cable" }, byName.Items.Select(r => r.ItemName));
    }

    [Fact]
    public async Task Movements_FromAfterTo_Is400()
    {
        var c = await SeedAsync(await NewDbAsync());

        var result = await Movements(c).Movements(c.Id, Mar31, Mar5);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.IsType<BadRequestObjectResult>(await Movements(c).MovementsExport(c.Id, Mar31, Mar5));
    }

    [Theory]
    [InlineData(typeof(StockMovementsReportController))]
    public void EveryStockReportAction_IsGatedOnTheInventoryModule_LikeTheExistingStockReports(Type controller)
    {
        StockReportTestSupport.AssertGatedOnInventory(controller);
    }
}
