using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pako.Api.Authorization;
using Pako.Api.Services;
using Pako.Domain.Hr;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports/stock")]
[Authorize]
public class StockReportExportsController : ControllerBase
{
    private readonly StockReportDataService _data;
    private readonly ExportLabels _labels;

    public StockReportExportsController(StockReportDataService data, ExportLabels labels)
    {
        _data = data;
        _labels = labels;
    }

    [ProducesXlsx]
    [HttpGet("levels/export", Name = "StockLevelsExport")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<IActionResult> LevelsExport(Guid companyId, [FromQuery] string? search = null, [FromQuery] Guid? warehouseId = null,
        [FromQuery] Guid? categoryId = null, [FromQuery] bool belowMinimum = false)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var rows = await _data.LevelsAsync(companyId, search, warehouseId, categoryId, belowMinimum, today);

        var headers = new[]
        {
            _labels["Stock_Col_Code"], _labels["Stock_Col_Name"], _labels["Stock_Col_Category"], _labels["Common_Unit"], _labels["Stock_Col_Quantity"],
            _labels["Stock_Col_AverageCost"], _labels["Stock_Col_Value"], _labels["Stock_Col_MinimumStock"], _labels["Stock_Col_SellPrice"], _labels["Stock_Col_Markup"],
        };
        var data = rows.Select(r => (IReadOnlyList<object?>)new object?[]
        {
            r.ItemCode, r.ItemName, r.CategoryName, r.Unit, r.Quantity, r.AverageCost, r.Value, r.MinimumStock, r.SellPriceExVat, r.MarkupPercent,
        }).ToList();
        data.Add(new object?[] { null, _labels["Common_Total"], null, null, null, null, rows.Sum(r => r.Value), null, null, null });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Stock_Sheet_Levels"], headers, data);
        return File(bytes, ExcelExportService.XlsxContentType, $"stock-levels-{today:yyyy-MM-dd}.xlsx");
    }

    [ProducesXlsx]
    [HttpGet("valuation/export", Name = "StockValuationExport")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<IActionResult> ValuationExport(Guid companyId, [FromQuery(Name = "asOf")] DateOnly? asOfDate = null)
    {
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var valuation = await _data.ValuationAsync(companyId, asOf);

        var block = new List<(string Label, object? Value)>
        {
            (_labels["Stock_Col_AsOf"], valuation.AsOf),
            (_labels["Stock_Col_StockValue"], valuation.StockValue),
            (_labels["Stock_Col_LedgerValue"], valuation.LedgerValue),
            (_labels["Common_Difference"], valuation.Difference),
        };
        var headers = new[]
        {
            _labels["Stock_Col_Code"], _labels["Stock_Col_Name"], _labels["Common_Unit"], _labels["Stock_Col_Quantity"],
            _labels["Stock_Col_AverageCost"], _labels["Stock_Col_Value"],
        };
        var data = valuation.Items.Select(r => (IReadOnlyList<object?>)new object?[]
        {
            r.ItemCode, r.ItemName, r.Unit, r.Quantity, r.AverageCost, r.Value,
        }).ToList();
        data.Add(new object?[] { null, _labels["Common_Total"], null, null, null, valuation.StockValue });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Stock_Sheet_Valuation"], block, headers, data);
        return File(bytes, ExcelExportService.XlsxContentType, $"stock-valuation-{asOf:yyyy-MM-dd}.xlsx");
    }

    [ProducesXlsx]
    [HttpGet("items/{itemId:guid}/card/export", Name = "ItemCardExport")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<IActionResult> ItemCardExport(Guid companyId, Guid itemId, [FromQuery] DateOnly? from = null, [FromQuery] DateOnly? to = null)
    {
        var card = await _data.CardAsync(companyId, itemId, from, to);
        if (card is null) return NotFound();

        var block = new List<(string Label, object? Value)>
        {
            (_labels["Stock_Col_Code"], card.ItemCode),
            (_labels["Stock_Col_Name"], card.ItemName),
            (_labels["Common_Unit"], card.Unit),
            (_labels["Common_From"], card.From),
            (_labels["Common_To"], card.To),
            (_labels["Stock_Col_OpeningQty"], card.OpeningQuantity),
            (_labels["Stock_Col_OpeningValue"], card.OpeningValue),
            (_labels["Stock_Col_ClosingQty"], card.ClosingQuantity),
            (_labels["Stock_Col_ClosingValue"], card.ClosingValue),
        };
        var headers = new[]
        {
            _labels["Common_Date"], _labels["Stock_Col_MoveType"], _labels["Stock_Col_Source"], _labels["Stock_Col_Reference"],
            _labels["Stock_Col_FromLocation"], _labels["Stock_Col_ToLocation"], _labels["Stock_Col_InQty"], _labels["Stock_Col_OutQty"],
            _labels["Stock_Col_UnitCost"], _labels["Stock_Col_Value"], _labels["Stock_Col_RunningQty"], _labels["Stock_Col_AverageCost"], _labels["Stock_Col_RunningValue"],
        };
        var data = card.Rows.Select(r => (IReadOnlyList<object?>)new object?[]
        {
            r.Date, _labels["Stock_Kind_" + r.Kind], _labels["Stock_Source_" + r.SourceType], r.Reference, r.FromLocation, r.ToLocation,
            r.QuantityIn, r.QuantityOut, r.UnitCost, r.Value, r.QtyAfter, r.AvgCostAfter, r.ValueAfter,
        }).ToList();

        var period = card.From is { } f && card.To is { } t ? $"{f:yyyy-MM-dd}-{t:yyyy-MM-dd}" : "all";
        var bytes = ExcelExportService.BuildWorkbook(_labels["Stock_Sheet_ItemCard"], block, headers, data);
        return File(bytes, ExcelExportService.XlsxContentType, $"item-card-{card.ItemCode}-{period}.xlsx");
    }
}
