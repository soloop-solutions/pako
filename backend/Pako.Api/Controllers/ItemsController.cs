using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Infrastructure;
using Pako.Domain.Hr;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/items")]
[Authorize]
public class ItemsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numberSeries;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public ItemsController(PakoDbContext db, NumberSeriesService numberSeries, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _numberSeries = numberSeries;
        _localizer = localizer;
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

        return Ok(new PaginatedResponse<ItemResponse>(items.Select(i => ToResponse(i)).ToList(), total, page, pageSize));
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
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    [ProducesResponseType(typeof(ItemResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ItemResponse>> Create(Guid companyId, CreateItemRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest("Item name is required.");
        if (string.IsNullOrWhiteSpace(request.Unit))
            return BadRequest("Unit is required.");

        var accountError = await ValidateDefaultAccounts(companyId, request.DefaultRevenueAccountId, request.DefaultExpenseAccountId, request.DefaultInventoryAccountId);
        if (accountError is not null) return accountError;
        var stockError = await ValidateStockFieldsAsync(companyId, null, request.Type, request.CategoryId, request.TrackInventory, request.MinimumStock);
        if (stockError is not null) return BadRequest(stockError);

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
            Description = request.Description?.Trim(),
            Unit = request.Unit.Trim(),
            Type = request.Type,
            DefaultTaxDefinitionId = request.DefaultTaxDefinitionId,
            DefaultRevenueAccountId = request.DefaultRevenueAccountId,
            DefaultExpenseAccountId = request.DefaultExpenseAccountId,
            DefaultInventoryAccountId = request.DefaultInventoryAccountId,
            DefaultUnitPrice = request.DefaultUnitPrice,
            CategoryId = request.CategoryId,
            TrackInventory = request.TrackInventory && request.Type == ItemType.Goods,
            MinimumStock = request.MinimumStock
        };

        _db.Items.Add(item);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(item));
    }

    [HttpPut("{itemId:guid}")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
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

        var accountError = await ValidateDefaultAccounts(companyId, request.DefaultRevenueAccountId, request.DefaultExpenseAccountId, request.DefaultInventoryAccountId);
        if (accountError is not null) return accountError;
        var stockError = await ValidateStockFieldsAsync(companyId, item, request.Type, request.CategoryId, request.TrackInventory, request.MinimumStock);
        if (stockError is not null) return BadRequest(stockError);
        // Moving the stock account of an item that carries stock would split its value over two
        // accounts.
        if (item.DefaultInventoryAccountId != request.DefaultInventoryAccountId && await _db.StockMoves.AnyAsync(m => m.ItemId == item.Id))
        {
            return BadRequest(_localizer["ItemInventoryAccountLocked"].Value);
        }

        item.Name = request.Name.Trim();
        item.Description = request.Description?.Trim();
        item.Unit = request.Unit.Trim();
        item.Type = request.Type;
        item.DefaultTaxDefinitionId = request.DefaultTaxDefinitionId;
        item.DefaultRevenueAccountId = request.DefaultRevenueAccountId;
        item.DefaultExpenseAccountId = request.DefaultExpenseAccountId;
        item.DefaultInventoryAccountId = request.DefaultInventoryAccountId;
        item.DefaultUnitPrice = request.DefaultUnitPrice;
        item.CategoryId = request.CategoryId;
        item.TrackInventory = request.TrackInventory && request.Type == ItemType.Goods;
        item.MinimumStock = request.MinimumStock;

        await _db.SaveChangesAsync();
        return Ok(ToResponse(item, await _db.StockMoves.AnyAsync(m => m.ItemId == item.Id)));
    }

    // B6: barcode management — add/remove barcodes per item.
    [HttpPost("{itemId:guid}/barcodes")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
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
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<ActionResult> RemoveBarcode(Guid companyId, Guid itemId, Guid barcodeId)
    {
        var barcode = await _db.ItemBarcodes
            .FirstOrDefaultAsync(b => b.Id == barcodeId && b.ItemId == itemId && b.CompanyId == companyId);

        if (barcode == null) return NotFound();

        _db.ItemBarcodes.Remove(barcode);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<ActionResult?> ValidateDefaultAccounts(Guid companyId, Guid? revenueAccountId, Guid? expenseAccountId, Guid? inventoryAccountId)
    {
        var accountIds = new[] { revenueAccountId, expenseAccountId, inventoryAccountId }
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        if (accountIds.Count == 0) return null;

        var validCount = await _db.Accounts.AsNoTracking()
            .CountAsync(a => accountIds.Contains(a.Id) && a.CompanyId == companyId);

        if (validCount != accountIds.Count)
            return BadRequest(_localizer["ItemDefaultAccountNotBelongToCompany"].Value);

        return null;
    }

    // docs/INVENTORY_PLAN.md: a category of this company; stock only for Goods (D8); once stock has
    // moved, tracking stays on and the item stays Goods — its history must keep meaning something.
    private async Task<string?> ValidateStockFieldsAsync(Guid companyId, Item? item, ItemType type, Guid? categoryId, bool track, decimal? minimum)
    {
        if (categoryId is { } c && !await _db.ItemCategories.AnyAsync(k => k.Id == c && k.CompanyId == companyId))
        {
            return _localizer["ItemCategoryNotFound"].Value;
        }
        if (minimum is < 0) return _localizer["StockDocumentQuantity"].Value;
        if (track && type != ItemType.Goods) return _localizer["StockOnlyForGoods"].Value;
        if (item is not null && item.TrackInventory && (!track || type != ItemType.Goods)
            && await _db.StockMoves.AnyAsync(m => m.ItemId == item.Id))
        {
            return _localizer["StockTrackingLocked"].Value;
        }
        return null;
    }

    private static ItemResponse ToResponse(Item i, bool hasStockMoves = false) => new(
        i.Id, i.Code, i.Name, i.Description, i.Unit, i.Type,
        i.DefaultTaxDefinitionId, i.DefaultRevenueAccountId, i.DefaultExpenseAccountId, i.DefaultInventoryAccountId,
        i.DefaultUnitPrice,
        i.Barcodes.Select(b => new ItemBarcodeResponse(b.Id, b.Barcode)).ToList(),
        i.CategoryId, i.TrackInventory, i.MinimumStock, hasStockMoves);
}
