using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/INVENTORY_PLAN.md §12 P4 — sales price lists and price changes (Nivelim). Pricing belongs to
// the Items area: View reads prices, Edit keeps lists and drafts, Approve posts a price change
// (it changes what every shop charges from its date).
[ApiController]
[Route("api/companies/{companyId:guid}")]
[Authorize]
public class PriceListsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PriceListsController(PakoDbContext db, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // ---- Lists ----

    [HttpGet("price-lists", Name = "ListPriceLists")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<List<PriceListResponse>>> Lists(Guid companyId)
    {
        var lists = await _db.PriceLists.AsNoTracking().Where(p => p.CompanyId == companyId)
            .OrderBy(p => p.IsCustomerList).ThenBy(p => p.WarehouseId != null).ThenBy(p => p.Name).ToListAsync();
        var ids = lists.Select(p => p.Id).ToList();
        var counts = await _db.PriceListPrices.AsNoTracking().Where(p => ids.Contains(p.PriceListId))
            .GroupBy(p => p.PriceListId).Select(g => new { g.Key, Items = g.Select(p => p.ItemId).Distinct().Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Items);
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => w.CompanyId == companyId).ToDictionaryAsync(w => w.Id, w => w.Name);
        return Ok(lists.Select(p => new PriceListResponse(p.Id, p.Name, p.WarehouseId,
            p.WarehouseId is { } w ? warehouses.GetValueOrDefault(w) : null, p.IsActive, counts.GetValueOrDefault(p.Id), p.IsCustomerList)).ToList());
    }

    [HttpPost("price-lists", Name = "CreatePriceList")]
    [ProducesResponseType(typeof(PriceListResponse), StatusCodes.Status201Created)]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    [ProducesResponseType(typeof(PriceListResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PriceListResponse>> CreateList(Guid companyId, SavePriceListRequest request)
    {
        if (await ValidateListAsync(companyId, null, request) is { } error) return BadRequest(error);
        var list = new PriceList
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Name = request.Name.Trim(), WarehouseId = request.IsCustomerList ? null : request.WarehouseId,
            IsCustomerList = request.IsCustomerList,
        };
        _db.PriceLists.Add(list);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, await ListResponseAsync(list));
    }

    [HttpPut("price-lists/{priceListId:guid}", Name = "UpdatePriceList")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<ActionResult<PriceListResponse>> UpdateList(Guid companyId, Guid priceListId, SavePriceListRequest request)
    {
        var list = await _db.PriceLists.FirstOrDefaultAsync(p => p.Id == priceListId && p.CompanyId == companyId);
        if (list is null) return NotFound();
        if (await ValidateListAsync(companyId, priceListId, request) is { } error) return BadRequest(error);
        if (list.IsCustomerList != request.IsCustomerList) return BadRequest(_localizer["PriceListKindFixed"].Value);
        list.Name = request.Name.Trim();
        list.WarehouseId = request.IsCustomerList ? null : request.WarehouseId;
        list.IsActive = request.IsActive;
        await _db.SaveChangesAsync();
        return Ok(await ListResponseAsync(list));
    }

    private async Task<string?> ValidateListAsync(Guid companyId, Guid? id, SavePriceListRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 120) return _localizer["PriceListName"].Value;
        if (await _db.PriceLists.AnyAsync(p => p.CompanyId == companyId && p.Id != id && p.Name == request.Name.Trim()))
        {
            return _localizer["PriceListNameTaken"].Value;
        }
        if (request.WarehouseId is { } w && !await _db.Warehouses.AnyAsync(x => x.Id == w && x.CompanyId == companyId))
        {
            return _localizer["WarehouseNotFound"].Value;
        }
        if (request.IsCustomerList && request.WarehouseId is not null) return _localizer["PriceListCustomerNoWarehouse"].Value;
        if (!request.IsCustomerList
            && await _db.PriceLists.AnyAsync(p => p.CompanyId == companyId && p.Id != id && !p.IsCustomerList && p.WarehouseId == request.WarehouseId))
        {
            return _localizer["PriceListWarehouseTaken"].Value;
        }
        return null;
    }

    private async Task<PriceListResponse> ListResponseAsync(PriceList list)
    {
        var warehouse = list.WarehouseId is { } w ? await _db.Warehouses.AsNoTracking().Where(x => x.Id == w).Select(x => x.Name).FirstOrDefaultAsync() : null;
        var priced = await _db.PriceListPrices.AsNoTracking().Where(p => p.PriceListId == list.Id).Select(p => p.ItemId).Distinct().CountAsync();
        return new PriceListResponse(list.Id, list.Name, list.WarehouseId, warehouse, list.IsActive, priced, list.IsCustomerList);
    }

    // Every sellable item with its price on the list at the date (paged, searchable). A warehouse
    // list falls back to the company list, then to the item's own price.
    [HttpGet("price-lists/{priceListId:guid}/items", Name = "ListPriceListItems")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<PaginatedResponse<PriceListItemResponse>>> Items(Guid companyId, Guid priceListId,
        [FromQuery(Name = "date")] DateOnly? dateParam = null, [FromQuery] string? search = null, [FromQuery] bool onlyPriced = false,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var list = await _db.PriceLists.AsNoTracking().FirstOrDefaultAsync(p => p.Id == priceListId && p.CompanyId == companyId);
        if (list is null) return NotFound();
        var date = dateParam ?? DateOnly.FromDateTime(DateTime.UtcNow);
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var items = _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            items = items.Where(i => EF.Functions.ILike(i.Name, pattern) || EF.Functions.ILike(i.Code.ToString(), pattern));
        }
        if (onlyPriced) items = items.Where(i => _db.PriceListPrices.Any(p => p.PriceListId == priceListId && p.ItemId == i.Id && p.ValidFrom <= date));
        var total = await items.CountAsync();
        var pageItems = await items.OrderBy(i => i.Code).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var ids = pageItems.Select(i => i.Id).ToList();
        var own = await _prices.PricesOnAsync(priceListId, date, ids);
        var tiers = await _prices.TiersOnAsync(priceListId, date, ids);
        // What applies when this list has no price: for a shop list, the company list or the item.
        var fallback = (await _prices.ResolveAsync(companyId, null, date, ids)).ToDictionary(r => r.ItemId, r => r.Price);
        var rows = pageItems.Select(i => new PriceListItemResponse(i.Id, i.Code, i.Name, i.Unit,
            own.TryGetValue(i.Id, out var p) ? p.Price : null, own.TryGetValue(i.Id, out var q) ? q.ValidFrom : null,
            list.WarehouseId is null && !list.IsCustomerList ? i.DefaultUnitPrice : fallback.TryGetValue(i.Id, out var f) ? f : null,
            tiers.TryGetValue(i.Id, out var t) ? t.Select(x => new PriceTierResponse(x.MinQuantity, x.Price, x.ValidFrom)).ToList() : null)).ToList();
        return Ok(new PaginatedResponse<PriceListItemResponse>(rows, total, page, pageSize));
    }

    // The starting price for document lines in a warehouse on a date (invoice form).
    [HttpGet("prices/resolve", Name = "ResolvePrices")]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<ResolvedPriceResponse>>> Resolve(Guid companyId, [FromQuery] List<Guid> itemIds,
        [FromQuery] Guid? warehouseId = null, [FromQuery(Name = "date")] DateOnly? dateParam = null,
        [FromQuery] Guid? partnerId = null, [FromQuery] List<decimal>? quantities = null)
    {
        if (itemIds.Count == 0) return Ok(new List<ResolvedPriceResponse>());
        if (itemIds.Count > 500) itemIds = itemIds.Take(500).ToList();
        // docs/POS_PLAN.md P6: quantities (base units) pair with itemIds by position and pick volume
        // tiers; a repeated item adds up.
        Dictionary<Guid, decimal>? byItem = null;
        if (quantities is { Count: > 0 })
        {
            byItem = new();
            for (var i = 0; i < itemIds.Count && i < quantities.Count; i++) byItem[itemIds[i]] = byItem.GetValueOrDefault(itemIds[i]) + quantities[i];
        }
        return Ok(await _prices.ResolveAsync(companyId, warehouseId, dateParam ?? DateOnly.FromDateTime(DateTime.UtcNow), itemIds,
            partnerId: partnerId, quantities: byItem));
    }

    // ---- Price changes (Nivelim) ----

    [HttpGet("price-changes", Name = "ListPriceChanges")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<PaginatedResponse<PriceChangeSummaryResponse>>> Changes(Guid companyId,
        [FromQuery] Guid? priceListId = null, [FromQuery] string? search = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.PriceChanges.AsNoTracking().Where(d => d.CompanyId == companyId);
        if (priceListId is { } l) query = query.Where(d => d.PriceListId == l);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(d => d.Number != null && EF.Functions.ILike(d.Number, $"%{search.Trim()}%"));
        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(d => d.Date).ThenByDescending(d => d.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(d => new { d.Id, d.PriceListId, d.State, d.Number, d.Date, Lines = d.Lines.Count, Difference = d.Lines.Sum(x => x.Difference ?? 0m) })
            .ToListAsync();
        var lists = await _db.PriceLists.AsNoTracking().Where(p => p.CompanyId == companyId).ToDictionaryAsync(p => p.Id, p => p.Name);
        return Ok(new PaginatedResponse<PriceChangeSummaryResponse>(rows.Select(d => new PriceChangeSummaryResponse(d.Id,
            lists.GetValueOrDefault(d.PriceListId) ?? "?", d.State, d.Number, d.Date, d.Lines, d.Difference)).ToList(), total, page, pageSize));
    }

    [HttpGet("price-changes/{id:guid}", Name = "GetPriceChange")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<ActionResult<PriceChangeResponse>> GetChange(Guid companyId, Guid id)
    {
        var change = await LoadAsync(companyId, id, tracking: false);
        return change is null ? NotFound() : Ok(await _prices.ToResponseAsync(companyId, change));
    }

    [HttpPost("price-changes", Name = "CreatePriceChange")]
    [ProducesResponseType(typeof(PriceChangeResponse), StatusCodes.Status201Created)]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    [ProducesResponseType(typeof(PriceChangeResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PriceChangeResponse>> CreateChange(Guid companyId, SavePriceChangeRequest request)
    {
        try
        {
            var change = await _prices.SaveDraftAsync(companyId, null, request);
            await _db.SaveChangesAsync();
            return StatusCode(StatusCodes.Status201Created, await _prices.ToResponseAsync(companyId, change));
        }
        catch (StockException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPut("price-changes/{id:guid}", Name = "UpdatePriceChange")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<ActionResult<PriceChangeResponse>> UpdateChange(Guid companyId, Guid id, SavePriceChangeRequest request)
    {
        var change = await LoadAsync(companyId, id, tracking: true);
        if (change is null) return NotFound();
        try
        {
            await _prices.SaveDraftAsync(companyId, change, request);
            await _db.SaveChangesAsync();
            return Ok(await _prices.ToResponseAsync(companyId, change));
        }
        catch (StockException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpDelete("price-changes/{id:guid}", Name = "DiscardPriceChange")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<IActionResult> DiscardChange(Guid companyId, Guid id)
    {
        var change = await LoadAsync(companyId, id, tracking: true);
        if (change is null) return NotFound();
        if (change.IsPosted) return BadRequest(_localizer["PriceChangePosted"].Value);
        _db.PriceChanges.Remove(change);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("price-changes/{id:guid}/post", Name = "PostPriceChange")]
    [RequireCompanyAccess(module: AccessModule.Items, approve: true)]
    public async Task<ActionResult<PriceChangeResponse>> PostChange(Guid companyId, Guid id)
    {
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        var change = await LoadAsync(companyId, id, tracking: true);
        if (change is null) return NotFound();
        try
        {
            await _prices.PostAsync(companyId, change, CurrentUserId);
            await _db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Ok(await _prices.ToResponseAsync(companyId, change));
        }
        catch (StockException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    // The printable shelf record: old and new prices, quantity on hand and the difference.
    [Produces(PayslipPdfRenderer.PdfContentType)]
    [HttpGet("price-changes/{id:guid}/pdf", Name = "GetPriceChangePdf")]
    [RequireCompanyAccess(module: AccessModule.Items)]
    public async Task<IActionResult> ChangePdf(Guid companyId, Guid id)
    {
        var change = await LoadAsync(companyId, id, tracking: false);
        if (change is null) return NotFound();
        var response = await _prices.ToResponseAsync(companyId, change);
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == companyId);
        var bytes = StockPdfRenderer.RenderPriceChange(DocumentIssuer.From(company), response, key => _localizer[key].Value, CultureInfo.CurrentUICulture);
        return File(bytes, PayslipPdfRenderer.PdfContentType, $"nivelim-{(response.Number ?? "draft").Replace('/', '-')}.pdf");
    }

    private Task<PriceChange?> LoadAsync(Guid companyId, Guid id, bool tracking)
    {
        var query = _db.PriceChanges.Include(d => d.Lines).Where(d => d.Id == id && d.CompanyId == companyId);
        return (tracking ? query : query.AsNoTracking()).FirstOrDefaultAsync();
    }
}
