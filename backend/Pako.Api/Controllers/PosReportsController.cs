using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P2: store reporting and shelf labels (Pos: Read).
[ApiController]
[Route("api/companies/{companyId:guid}/pos")]
[Authorize]
public class PosReportsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PosReportService _reports;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosReportsController(PakoDbContext db, PosReportService reports, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _reports = reports;
        _prices = prices;
        _localizer = localizer;
    }

    [HttpGet("reports/sales", Name = "GetPosSalesReport")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PosSalesReportResponse>> Sales(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] PosReportGroup groupBy = PosReportGroup.Day, [FromQuery] Guid? storeId = null, [FromQuery] Guid? registerId = null)
    {
        if (to < from || to.DayNumber - from.DayNumber > 400) return BadRequest(_localizer["PosReportPeriodInvalid"].Value);
        return Ok(await _reports.SalesAsync(companyId, from, to, groupBy, storeId, registerId));
    }

    // P3: recipe ingredients — theoretical use against what counts and write-offs show.
    [HttpGet("reports/usage-variance", Name = "GetUsageVariance")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<UsageVarianceResponse>> UsageVariance(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (to < from || to.DayNumber - from.DayNumber > 400) return BadRequest(_localizer["PosReportPeriodInvalid"].Value);
        var ingredients = await _db.RecipeLines.AsNoTracking().Where(r => _db.Items.Any(i => i.Id == r.ItemId && i.CompanyId == companyId))
            .Select(r => r.IngredientItemId).Distinct().ToListAsync();
        var moves = await _db.StockMoves.AsNoTracking()
            .Where(m => m.CompanyId == companyId && ingredients.Contains(m.ItemId) && m.Date >= from && m.Date <= to
                && (m.SourceType == Pako.Domain.Inventory.StockMoveSource.Pos || m.SourceType == Pako.Domain.Inventory.StockMoveSource.StockDocument))
            .Select(m => new
            {
                m.ItemId, m.Kind, m.Quantity, m.Value, m.SourceType,
                DocumentType = _db.StockDocuments.Where(d => d.Id == m.SourceId).Select(d => (Pako.Domain.Inventory.StockDocumentType?)d.Type).FirstOrDefault(),
            })
            .ToListAsync();
        var items = await _db.Items.AsNoTracking().Where(i => ingredients.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var rows = ingredients.Select(id =>
        {
            var own = moves.Where(m => m.ItemId == id).ToList();
            var pos = own.Where(m => m.SourceType == Pako.Domain.Inventory.StockMoveSource.Pos);
            var theoretical = pos.Where(m => m.Kind == Pako.Domain.Inventory.StockMoveKind.Issue).Sum(m => m.Quantity)
                - pos.Where(m => m.Kind == Pako.Domain.Inventory.StockMoveKind.Receipt).Sum(m => m.Quantity);
            var counts = own.Where(m => m.DocumentType == Pako.Domain.Inventory.StockDocumentType.Count).ToList();
            static decimal Signed(Pako.Domain.Inventory.StockMoveKind kind, decimal v) => kind == Pako.Domain.Inventory.StockMoveKind.Issue ? -v : v;
            var difference = counts.Sum(m => Signed(m.Kind, m.Quantity));
            var differenceValue = counts.Sum(m => Signed(m.Kind, m.Value));
            var writtenOff = own.Where(m => m.DocumentType == Pako.Domain.Inventory.StockDocumentType.WriteOff).Sum(m => m.Quantity);
            decimal? percent = theoretical > 0 ? Math.Round(-difference / theoretical * 100m, 2, MidpointRounding.AwayFromZero) : null;
            var item = items[id];
            return new UsageVarianceRow(id, item.Name, item.Unit, theoretical, difference, writtenOff, percent, differenceValue);
        }).OrderByDescending(r => r.VariancePercent ?? 0m).ThenBy(r => r.Name).ToList();
        return Ok(new UsageVarianceResponse(from, to, rows));
    }

    // Shelf labels for these items at a store's prices.
    [Produces(PayslipPdfRenderer.PdfContentType)]
    [HttpGet("labels/pdf", Name = "GetPosLabelsPdf")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<IActionResult> Labels(Guid companyId, [FromQuery] Guid storeId, [FromQuery] List<Guid> itemIds)
    {
        var store = await _db.PosStores.AsNoTracking().FirstOrDefaultAsync(s => s.Id == storeId && s.CompanyId == companyId);
        if (store is null) return NotFound();
        if (itemIds.Count == 0 || itemIds.Count > 600) return BadRequest(_localizer["PosLabelsCountInvalid"].Value);
        var items = await _db.Items.AsNoTracking().Include(i => i.Barcodes).Where(i => i.CompanyId == companyId && itemIds.Contains(i.Id))
            .OrderBy(i => i.Name).ToListAsync();
        var today = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));
        var prices = (await _prices.ResolveAsync(companyId, store.WarehouseId, today, items.Select(i => i.Id).ToList(), store.PriceListId))
            .ToDictionary(p => p.ItemId, p => p.Price);
        var labels = items.Select(i => new PosLabelRenderer.Label(i.Name, prices.TryGetValue(i.Id, out var p) ? p : null, i.Unit, i.Code.ToString(),
            i.Barcodes.Select(b => b.Barcode).FirstOrDefault(), i.Plu)).ToList();
        var bytes = PosLabelRenderer.Render(labels, store.Name, today, key => _localizer[key].Value, CultureInfo.CurrentUICulture);
        return File(bytes, PayslipPdfRenderer.PdfContentType, $"labels-{store.Code}-{today:yyyyMMdd}.pdf");
    }
}
