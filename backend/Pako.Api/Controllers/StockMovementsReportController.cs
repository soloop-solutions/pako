using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Reporting;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports/stock")]
[Authorize]
public class StockMovementsReportController : ControllerBase
{
    private readonly StockMovementsService _movements;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ExportLabels _labels;

    public StockMovementsReportController(StockMovementsService movements, IStringLocalizer<ErrorMessages> localizer, ExportLabels labels)
    {
        _movements = movements;
        _localizer = localizer;
        _labels = labels;
    }

    [HttpGet("movements", Name = "StockMovementsReport")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<StockMovementsReportResponse>> Movements(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? search = null, [FromQuery] Guid? categoryId = null, [FromQuery] Guid? warehouseId = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, [FromQuery] string? sort = null)
    {
        if (from > to) return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        var rows = await _movements.RowsAsync(companyId, from, to, search, categoryId, warehouseId, sort);
        return Ok(StockMovementsService.Page(from, to, rows, page, pageSize));
    }

    [ProducesXlsx]
    [HttpGet("movements/export", Name = "StockMovementsExport")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<IActionResult> MovementsExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? search = null, [FromQuery] Guid? categoryId = null, [FromQuery] Guid? warehouseId = null,
        [FromQuery] string? sort = null)
    {
        if (from > to) return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        var rows = await _movements.RowsAsync(companyId, from, to, search, categoryId, warehouseId, sort);
        var totals = StockMovementsCalculator.Totals(rows.Select(r => (r.OpeningValue, r.InValue, r.OutValue, r.ClosingValue)));

        var headers = new[]
        {
            _labels["Stock_Col_Code"], _labels["Stock_Col_Name"], _labels["Common_Unit"],
            _labels["Stock_Col_OpeningQty"], _labels["Stock_Col_OpeningValue"], _labels["Stock_Col_InQty"], _labels["Stock_Col_InValue"],
            _labels["Stock_Col_OutQty"], _labels["Stock_Col_OutValue"], _labels["Stock_Col_ClosingQty"], _labels["Stock_Col_AverageCost"],
            _labels["Stock_Col_ClosingValue"], _labels["Stock_Col_SellPrice"], _labels["Stock_Col_Markup"],
        };
        var data = rows.Select(r => (IReadOnlyList<object?>)new object?[]
        {
            r.ItemCode, r.ItemName, r.Unit, r.OpeningQuantity, r.OpeningValue, r.InQuantity, r.InValue, r.OutQuantity, r.OutValue,
            r.ClosingQuantity, r.AverageCost, r.ClosingValue, r.SellPriceExVat, r.MarkupPercent,
        }).ToList();
        data.Add(new object?[]
        {
            null, _labels["Common_Total"], null, null, totals.OpeningValue, null, totals.InValue, null, totals.OutValue,
            null, null, totals.ClosingValue, null, null,
        });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Stock_Sheet_Movements"], headers, data);
        return File(bytes, ExcelExportService.XlsxContentType, $"stock-movements-{from:yyyy-MM-dd}-{to:yyyy-MM-dd}.xlsx");
    }
}
