using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/INVENTORY_PLAN.md — opening stock, transfers, counts and write-offs. Inventory: Edit drafts,
// Inventory: Approve posts (posting moves stock and writes the ledger, so it can't be undone).
[ApiController]
[Route("api/companies/{companyId:guid}/stock-documents")]
[Authorize]
public class StockDocumentsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly StockDocumentService _documents;
    private readonly StockService _stock;
    private readonly Microsoft.Extensions.Localization.IStringLocalizer<ErrorMessages> _localizer;

    public StockDocumentsController(PakoDbContext db, StockDocumentService documents, StockService stock,
        Microsoft.Extensions.Localization.IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _documents = documents;
        _stock = stock;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // B7 paging; ?search= matches the number.
    [HttpGet(Name = "ListStockDocuments")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<PaginatedResponse<StockDocumentSummaryResponse>>> List(Guid companyId,
        [FromQuery] StockDocumentType? type = null, [FromQuery] string? search = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, [FromQuery] Guid? siteId = null)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.StockDocuments.AsNoTracking().Where(d => d.CompanyId == companyId);
        if (type is { } t) query = query.Where(d => d.Type == t);
        if (siteId is { } site) query = query.Where(d => d.SiteId == site);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(d => d.Number != null && EF.Functions.ILike(d.Number, $"%{search.Trim()}%"));
        var total = await query.CountAsync();
        var documents = await query.OrderByDescending(d => d.Date).ThenByDescending(d => d.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(d => new { d.Id, d.Type, d.State, d.Number, d.Date, d.WarehouseId, d.DestinationWarehouseId, Lines = d.Lines.Count, d.SiteId,
                PartnerName = _db.Partners.Where(p => p.Id == d.PartnerId).Select(p => p.Name).FirstOrDefault(),
                WriteDown = d.Lines.Sum(l => l.Amount ?? 0m) })
            .ToListAsync();
        var ids = documents.Select(d => d.Id).ToList();
        var values = await _db.StockMoves.AsNoTracking()
            .Where(m => m.SourceType == StockMoveSource.StockDocument && ids.Contains(m.SourceId))
            .GroupBy(m => m.SourceId).Select(g => new { g.Key, Value = g.Sum(m => m.Value) })
            .ToDictionaryAsync(g => g.Key, g => g.Value);
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => w.CompanyId == companyId).ToDictionaryAsync(w => w.Id, w => w.Name);
        return Ok(new PaginatedResponse<StockDocumentSummaryResponse>(documents.Select(d => new StockDocumentSummaryResponse(
            d.Id, d.Type, d.State, d.Number, d.Date, warehouses.GetValueOrDefault(d.WarehouseId) ?? "?",
            d.DestinationWarehouseId is { } dest ? warehouses.GetValueOrDefault(dest) : null, d.Lines,
            // A write-down moves no stock: its value is the allowance change.
            d.Type == StockDocumentType.WriteDown ? d.WriteDown : values.GetValueOrDefault(d.Id), d.PartnerName, d.SiteId)).ToList(),
            total, page, pageSize));
    }

    [HttpGet("{id:guid}", Name = "GetStockDocument")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<StockDocumentResponse>> Get(Guid companyId, Guid id)
    {
        var document = await Load(companyId, id, tracking: false);
        return document is null ? NotFound() : Ok(await _documents.ToResponseAsync(document));
    }

    [HttpPost(Name = "CreateStockDocument")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    [ProducesResponseType(typeof(StockDocumentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<StockDocumentResponse>> Create(Guid companyId, SaveStockDocumentRequest request)
    {
        try
        {
            var document = await _documents.SaveDraftAsync(companyId, null, request);
            await _db.SaveChangesAsync();
            return StatusCode(StatusCodes.Status201Created, await _documents.ToResponseAsync(document));
        }
        catch (StockException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPut("{id:guid}", Name = "UpdateStockDocument")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    public async Task<ActionResult<StockDocumentResponse>> Update(Guid companyId, Guid id, SaveStockDocumentRequest request)
    {
        var document = await Load(companyId, id, tracking: true);
        if (document is null) return NotFound();
        try
        {
            await _documents.SaveDraftAsync(companyId, document, request);
            await _db.SaveChangesAsync();
            return Ok(await _documents.ToResponseAsync(document));
        }
        catch (StockException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    // Only drafts can be discarded; a posted document is corrected with another document.
    [HttpDelete("{id:guid}", Name = "DiscardStockDocument")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    public async Task<IActionResult> Discard(Guid companyId, Guid id)
    {
        var document = await Load(companyId, id, tracking: true);
        if (document is null) return NotFound();
        if (document.IsPosted) return BadRequest(_localizer["StockDocumentPosted"].Value);
        _db.StockDocuments.Remove(document);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:guid}/post", Name = "PostStockDocument")]
    [RequireCompanyAccess(module: AccessModule.Inventory, approve: true)]
    public async Task<ActionResult<StockDocumentResponse>> Post(Guid companyId, Guid id)
    {
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
        var document = await Load(companyId, id, tracking: true);
        if (document is null) return NotFound();
        try
        {
            await _documents.PostAsync(company, document, CurrentUserId);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Ok(await _documents.ToResponseAsync(document));
        }
        catch (Exception ex) when (ex is StockException or InvalidOperationException
            or Pako.Domain.Ledger.AccountingLockDateViolationException or Pako.Domain.Ledger.HardLockDateViolationException
            or Pako.Domain.Ledger.TaxLockDateViolationException
            or Pako.Domain.Ledger.UnbalancedJournalEntryException)
        {
            return BadRequest(ex.Message);
        }
    }

    // The book quantity of every stock-tracked item in a warehouse at a date — what a count is
    // compared against, printable as the count sheet.
    [HttpGet("count-sheet", Name = "GetCountSheet")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<List<CountSheetRowResponse>>> CountSheet(Guid companyId, [FromQuery] Guid warehouseId, [FromQuery] DateOnly date)
    {
        var rows = await CountSheetRowsAsync(companyId, warehouseId, date);
        return rows is null ? NotFound() : Ok(rows);
    }

    // The count sheet to print and count against. ?blind=true leaves out the book quantity.
    [Produces(PayslipPdfRenderer.PdfContentType)]
    [HttpGet("count-sheet/pdf", Name = "GetCountSheetPdf")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<IActionResult> CountSheetPdf(Guid companyId, [FromQuery] Guid warehouseId, [FromQuery] DateOnly date, [FromQuery] bool blind = false)
    {
        var rows = await CountSheetRowsAsync(companyId, warehouseId, date);
        if (rows is null) return NotFound();
        var warehouse = await _db.Warehouses.AsNoTracking().FirstAsync(w => w.Id == warehouseId);
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var bytes = StockPdfRenderer.RenderCountSheet(DocumentIssuer.From(company), warehouse.Name, date, blind, rows,
            key => _localizer[key].Value, CultureInfo.CurrentUICulture);
        return File(bytes, PayslipPdfRenderer.PdfContentType, $"count-sheet-{warehouse.Code}-{date:yyyyMMdd}.pdf");
    }

    private async Task<List<CountSheetRowResponse>?> CountSheetRowsAsync(Guid companyId, Guid warehouseId, DateOnly date)
    {
        if (!await _db.Warehouses.AnyAsync(w => w.Id == warehouseId && w.CompanyId == companyId)) return null;
        var location = await _stock.StockLocationAsync(companyId, warehouseId);
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.TrackInventory && i.Type == Pako.Domain.Companies.ItemType.Goods)
            .OrderBy(i => i.Code).Select(i => new { i.Id, i.Code, i.Name, i.Unit }).ToListAsync();
        var book = await _stock.QuantitiesAtAsync(location.Id, items.Select(i => i.Id).ToList(), date);
        return items.Select(i => new CountSheetRowResponse(i.Id, i.Code, i.Name, i.Unit, book.GetValueOrDefault(i.Id))).ToList();
    }

    private Task<StockDocument?> Load(Guid companyId, Guid id, bool tracking)
    {
        var query = tracking ? _db.StockDocuments : _db.StockDocuments.AsNoTracking();
        return query.Include(d => d.Lines).FirstOrDefaultAsync(d => d.Id == id && d.CompanyId == companyId);
    }
}
