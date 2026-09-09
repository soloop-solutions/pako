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

    // B7: paginated list with search. ?skip=0&take=50&search=laptop
    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<PaginatedResponse<ItemResponse>>> List(
        Guid companyId,
        [FromQuery] int skip = 0,
        [FromQuery] int take = 50,
        [FromQuery] string? search = null)
    {
        take = Math.Clamp(take, 1, 200);
        skip = Math.Max(skip, 0);

        var query = _db.Items.AsNoTracking()
            .Include(i => i.Barcodes)
            .Where(i => i.CompanyId == companyId);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(i =>
                i.Name.ToLower().Contains(term) ||
                i.Code.ToString().Contains(term) ||
                i.Barcodes.Any(b => b.Barcode.ToLower().Contains(term)));
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderBy(i => i.Code)
            .Skip(skip)
            .Take(take)
            .ToListAsync();

        return Ok(new PaginatedResponse<ItemResponse>(items.Select(ToResponse).ToList(), total));
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
            DefaultTaxDefinitionId = request.DefaultTaxDefinitionId,
            DefaultRevenueAccountId = request.DefaultRevenueAccountId,
            DefaultExpenseAccountId = request.DefaultExpenseAccountId,
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
        item.DefaultTaxDefinitionId = request.DefaultTaxDefinitionId;
        item.DefaultRevenueAccountId = request.DefaultRevenueAccountId;
        item.DefaultExpenseAccountId = request.DefaultExpenseAccountId;
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
        i.Id, i.Code, i.Name, i.Unit,
        i.DefaultTaxDefinitionId, i.DefaultRevenueAccountId, i.DefaultExpenseAccountId,
        i.DefaultUnitPrice,
        i.Barcodes.Select(b => new ItemBarcodeResponse(b.Id, b.Barcode)).ToList());
}
