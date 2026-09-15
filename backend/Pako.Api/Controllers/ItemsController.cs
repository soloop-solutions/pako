using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/items")]
[Authorize]
public class ItemsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numberSeries;

    public ItemsController(PakoDbContext db, NumberSeriesService numberSeries)
    {
        _db = db;
        _numberSeries = numberSeries;
    }

    // B7: the one paginated-list shape. ?page=1&pageSize=50&search=laptop&sort=name — sort takes
    // a field name (code|name), optionally prefixed "-" for descending (e.g. sort=-code);
    // unrecognised values fall back to the default (code, ascending).
    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<PaginatedResponse<ItemResponse>>> List(
        Guid companyId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? sort = null)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.Items.AsNoTracking()
            .Include(i => i.Barcodes)
            .Where(i => i.CompanyId == companyId);

        if (!string.IsNullOrWhiteSpace(search))
        {
            // B7 (35,000-row verify criterion): Name search goes through a trigram GIN index
            // (ix_items_name_trgm, AddItemNameTrigramIndex) rather than a sequential scan —
            // EF/Npgsql translates ILIKE '%term%' to a form the trigram index can serve. Code and
            // Barcode search stay Contains() too (both are typically short, low-cardinality-enough
            // strings that a scan across one company's own items is cheap regardless), but the
            // (CompanyId, Code) and (CompanyId, Barcode) indexes already narrow to this company
            // first before either ever has to examine the search term.
            var term = search.Trim();
            query = query.Where(i =>
                EF.Functions.ILike(i.Name, $"%{term}%") ||
                i.Code.ToString().Contains(term) ||
                i.Barcodes.Any(b => b.Barcode.Contains(term)));
        }

        var descending = sort is not null && sort.StartsWith('-');
        var sortField = descending ? sort![1..] : sort;
        query = sortField?.ToLowerInvariant() switch
        {
            "name" => descending ? query.OrderByDescending(i => i.Name) : query.OrderBy(i => i.Name),
            _ => descending ? query.OrderByDescending(i => i.Code) : query.OrderBy(i => i.Code)
        };

        var total = await query.CountAsync();
        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return Ok(new PaginatedResponse<ItemResponse>(items.Select(ToResponse).ToList(), total, page, pageSize));
    }

    [HttpGet("{itemId:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<ItemResponse>> Get(Guid companyId, Guid itemId)
    {
        var item = await _db.Items.AsNoTracking()
            .Include(i => i.Barcodes)
            .FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId);

        if (item == null) return NotFound();
        return Ok(ToResponse(item));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(ItemResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ItemResponse>> Create(Guid companyId, CreateItemRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Item name is required.");
        if (string.IsNullOrWhiteSpace(request.Unit))
            return BadRequest("Unit is required.");

        // B6: auto-assign the next ordinal code from the Item number series.
        var year = DateTime.UtcNow.Year;
        var codeStr = await _numberSeries.ReserveNextAsync(companyId, "Item", year);
        var code = int.Parse(codeStr);

        var item = new Item
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Code = code,
            Name = request.Name.Trim(),
            Unit = request.Unit.Trim(),
            Type = request.Type,
            DefaultTaxDefinitionId = request.DefaultTaxDefinitionId,
            DefaultRevenueAccountId = request.DefaultRevenueAccountId,
            DefaultExpenseAccountId = request.DefaultExpenseAccountId,
            DefaultInventoryAccountId = request.DefaultInventoryAccountId,
            DefaultUnitPrice = request.DefaultUnitPrice
        };

        _db.Items.Add(item);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(item));
    }

    [HttpPut("{itemId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<ItemResponse>> Update(Guid companyId, Guid itemId, UpdateItemRequest request)
    {
        var item = await _db.Items
            .Include(i => i.Barcodes)
            .FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId);

        if (item == null) return NotFound();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Item name is required.");
        if (string.IsNullOrWhiteSpace(request.Unit))
            return BadRequest("Unit is required.");

        item.Name = request.Name.Trim();
        item.Unit = request.Unit.Trim();
        item.Type = request.Type;
        item.DefaultTaxDefinitionId = request.DefaultTaxDefinitionId;
        item.DefaultRevenueAccountId = request.DefaultRevenueAccountId;
        item.DefaultExpenseAccountId = request.DefaultExpenseAccountId;
        item.DefaultInventoryAccountId = request.DefaultInventoryAccountId;
        item.DefaultUnitPrice = request.DefaultUnitPrice;

        await _db.SaveChangesAsync();
        return Ok(ToResponse(item));
    }

    // B6: barcode management — add/remove barcodes per item.
    [HttpPost("{itemId:guid}/barcodes")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(ItemBarcodeResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ItemBarcodeResponse>> AddBarcode(Guid companyId, Guid itemId, AddBarcodeRequest request)
    {
        var item = await _db.Items.FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId);
        if (item == null) return NotFound();

        if (string.IsNullOrWhiteSpace(request.Barcode))
            return BadRequest("Barcode is required.");

        var trimmed = request.Barcode.Trim();
        if (trimmed.Length > 64)
            return BadRequest("Barcode must be 64 characters or fewer.");

        var exists = await _db.ItemBarcodes.AnyAsync(b => b.CompanyId == companyId && b.Barcode == trimmed);
        if (exists)
            return BadRequest($"Barcode \"{trimmed}\" is already registered for another item in this company.");

        var barcode = new ItemBarcode
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            ItemId = itemId,
            Barcode = trimmed
        };

        _db.ItemBarcodes.Add(barcode);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, new ItemBarcodeResponse(barcode.Id, barcode.Barcode));
    }

    [HttpDelete("{itemId:guid}/barcodes/{barcodeId:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult> RemoveBarcode(Guid companyId, Guid itemId, Guid barcodeId)
    {
        var barcode = await _db.ItemBarcodes
            .FirstOrDefaultAsync(b => b.Id == barcodeId && b.ItemId == itemId && b.CompanyId == companyId);

        if (barcode == null) return NotFound();

        _db.ItemBarcodes.Remove(barcode);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private static ItemResponse ToResponse(Item i) => new(
        i.Id, i.Code, i.Name, i.Unit, i.Type,
        i.DefaultTaxDefinitionId, i.DefaultRevenueAccountId, i.DefaultExpenseAccountId, i.DefaultInventoryAccountId,
        i.DefaultUnitPrice,
        i.Barcodes.Select(b => new ItemBarcodeResponse(b.Id, b.Barcode)).ToList());
}
