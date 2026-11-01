using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Documents;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/INVENTORY_PLAN.md — warehouses, categories, stock settings and the stock reports. Reading needs
// Inventory: View (stock levels show cost); setup needs Inventory: Edit, settings Inventory: Approve.
[ApiController]
[Route("api/companies/{companyId:guid}/inventory")]
[Authorize]
public class InventoryController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly StockService _stock;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ITaxComputationService _tax;
    private readonly CompanyAccessContext _access;
    private readonly StockReportService _reports;

    public InventoryController(PakoDbContext db, StockService stock, IStringLocalizer<ErrorMessages> localizer,
        ITaxComputationService tax, CompanyAccessContext access)
    {
        _db = db;
        _stock = stock;
        _localizer = localizer;
        _tax = tax;
        _access = access;
        _reports = new StockReportService(db, access, tax);
    }

    // ---- Warehouses ----

    [HttpGet("warehouses", Name = "ListWarehouses")]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<WarehouseResponse>>> Warehouses(Guid companyId)
    {
        // Every company has a main warehouse from the first time anyone looks, so opening stock can
        // be entered before anything has moved. Two first looks at once: the unique code keeps one.
        if (!await _db.Warehouses.AnyAsync(w => w.CompanyId == companyId))
        {
            await _stock.DefaultWarehouseAsync(companyId);
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { _db.ChangeTracker.Clear(); }
        }

        var settings = await _db.StockSettings.AsNoTracking().FirstOrDefaultAsync(s => s.CompanyId == companyId);
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => w.CompanyId == companyId).OrderBy(w => w.Code).ToListAsync();
        return Ok(warehouses.Select(w => new WarehouseResponse(w.Id, w.Code, w.Name, w.Address, w.IsActive, w.Id == settings?.DefaultWarehouseId, w.IsVan, w.DriverUserId)).ToList());
    }

    [HttpPost("warehouses", Name = "CreateWarehouse")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    [ProducesResponseType(typeof(WarehouseResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<WarehouseResponse>> CreateWarehouse(Guid companyId, SaveWarehouseRequest request)
    {
        var error = await ValidateWarehouseAsync(companyId, null, request);
        if (error is not null) return BadRequest(error);
        var isFirst = !await _db.Warehouses.AnyAsync(w => w.CompanyId == companyId);
        var warehouse = await _stock.CreateWarehouseAsync(companyId, request.Code.Trim().ToUpperInvariant(), request.Name.Trim(), Blank(request.Address));
        if (isFirst) (await _stock.SettingsAsync(companyId)).DefaultWarehouseId = warehouse.Id;
        warehouse.IsVan = request.IsVan;
        warehouse.DriverUserId = request.IsVan ? request.DriverUserId : null;
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, new WarehouseResponse(warehouse.Id, warehouse.Code, warehouse.Name, warehouse.Address, true, isFirst,
            warehouse.IsVan, warehouse.DriverUserId));
    }

    [HttpPut("warehouses/{warehouseId:guid}", Name = "UpdateWarehouse")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    public async Task<ActionResult<WarehouseResponse>> UpdateWarehouse(Guid companyId, Guid warehouseId, SaveWarehouseRequest request)
    {
        var warehouse = await _db.Warehouses.FirstOrDefaultAsync(w => w.Id == warehouseId && w.CompanyId == companyId);
        if (warehouse is null) return NotFound();
        var error = await ValidateWarehouseAsync(companyId, warehouseId, request);
        if (error is not null) return BadRequest(error);
        var settings = await _stock.SettingsAsync(companyId);
        if (!request.IsActive)
        {
            // A warehouse with stock can't be closed: move the stock out first.
            var location = await _stock.StockLocationAsync(companyId, warehouseId);
            if (await _db.StockBalances.AnyAsync(b => b.LocationId == location.Id && b.Quantity != 0))
            {
                return BadRequest(_localizer["WarehouseHasStock"].Value);
            }
            if (settings.DefaultWarehouseId == warehouseId) return BadRequest(_localizer["WarehouseIsDefault"].Value);
        }
        warehouse.Code = request.Code.Trim().ToUpperInvariant();
        warehouse.Name = request.Name.Trim();
        warehouse.Address = Blank(request.Address);
        warehouse.IsActive = request.IsActive;
        warehouse.IsVan = request.IsVan;
        warehouse.DriverUserId = request.IsVan ? request.DriverUserId : null;
        await _db.SaveChangesAsync();
        return Ok(new WarehouseResponse(warehouse.Id, warehouse.Code, warehouse.Name, warehouse.Address, warehouse.IsActive, settings.DefaultWarehouseId == warehouse.Id,
            warehouse.IsVan, warehouse.DriverUserId));
    }

    private async Task<string?> ValidateWarehouseAsync(Guid companyId, Guid? id, SaveWarehouseRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Code) || request.Code.Trim().Length > 20 || string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 120)
        {
            return _localizer["WarehouseInvalid"].Value;
        }
        var code = request.Code.Trim().ToUpperInvariant();
        if (await _db.Warehouses.AnyAsync(w => w.CompanyId == companyId && w.Code == code && w.Id != id)) return _localizer["WarehouseCodeTaken"].Value;
        return null;
    }

    // ---- Categories ----

    [HttpGet("categories", Name = "ListItemCategories")]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<ItemCategoryResponse>>> Categories(Guid companyId)
    {
        var counts = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.CategoryId != null)
            .GroupBy(i => i.CategoryId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        var categories = await _db.ItemCategories.AsNoTracking().Where(c => c.CompanyId == companyId).OrderBy(c => c.Name).ToListAsync();
        return Ok(categories.Select(c => ToResponse(c, counts.GetValueOrDefault(c.Id))).ToList());
    }

    [HttpPost("categories", Name = "CreateItemCategory")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    [ProducesResponseType(typeof(ItemCategoryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ItemCategoryResponse>> CreateCategory(Guid companyId, SaveItemCategoryRequest request)
    {
        var category = new ItemCategory { Id = Guid.NewGuid(), CompanyId = companyId };
        var error = await ApplyCategoryAsync(companyId, category, request);
        if (error is not null) return BadRequest(error);
        _db.ItemCategories.Add(category);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, ToResponse(category, 0));
    }

    [HttpPut("categories/{categoryId:guid}", Name = "UpdateItemCategory")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Items)]
    public async Task<ActionResult<ItemCategoryResponse>> UpdateCategory(Guid companyId, Guid categoryId, SaveItemCategoryRequest request)
    {
        var category = await _db.ItemCategories.FirstOrDefaultAsync(c => c.Id == categoryId && c.CompanyId == companyId);
        if (category is null) return NotFound();
        var error = await ApplyCategoryAsync(companyId, category, request);
        if (error is not null) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(ToResponse(category, await _db.Items.CountAsync(i => i.CategoryId == categoryId)));
    }

    private async Task<string?> ApplyCategoryAsync(Guid companyId, ItemCategory category, SaveItemCategoryRequest request)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 120) return _localizer["ItemCategoryNameRequired"].Value;
        if (await _db.ItemCategories.AnyAsync(c => c.CompanyId == companyId && c.Name == name && c.Id != category.Id)) return _localizer["ItemCategoryNameTaken"].Value;
        var accountIds = new[] { request.InventoryAccountId, request.CogsAccountId, request.RevenueAccountId, request.ExpenseAccountId }
            .Where(a => a != null).Select(a => a!.Value).Distinct().ToList();
        if (await _db.Accounts.CountAsync(a => accountIds.Contains(a.Id) && a.CompanyId == companyId) != accountIds.Count)
        {
            return _localizer["AccountsNotBelongToCompany"].Value;
        }
        // Changing where stock is valued while items carry stock would split their value over two
        // accounts: refused once the category's items have moved.
        if (category.InventoryAccountId != request.InventoryAccountId && category.CreatedAt != default
            && await _db.StockMoves.AnyAsync(m => _db.Items.Any(i => i.Id == m.ItemId && i.CategoryId == category.Id)))
        {
            return _localizer["ItemCategoryInventoryAccountLocked"].Value;
        }
        category.Name = name;
        category.InventoryAccountId = request.InventoryAccountId;
        category.CogsAccountId = request.CogsAccountId;
        category.RevenueAccountId = request.RevenueAccountId;
        category.ExpenseAccountId = request.ExpenseAccountId;
        category.IsActive = request.IsActive;
        return null;
    }

    private static ItemCategoryResponse ToResponse(ItemCategory c, int items) =>
        new(c.Id, c.Name, c.InventoryAccountId, c.CogsAccountId, c.RevenueAccountId, c.ExpenseAccountId, c.IsActive, items);

    // ---- Settings ----

    [HttpGet("settings", Name = "GetStockSettings")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<StockSettingsResponse>> Settings(Guid companyId)
    {
        var settings = await _db.StockSettings.AsNoTracking().FirstOrDefaultAsync(s => s.CompanyId == companyId) ?? new StockSettings { CompanyId = companyId };
        var locked = await _db.StockMoves.AnyAsync(m => m.CompanyId == companyId);
        return Ok(new StockSettingsResponse(settings.CostMethod, settings.CostMethodSince, locked, settings.NegativeStock, settings.DefaultWarehouseId));
    }

    [HttpPut("settings", Name = "SaveStockSettings")]
    [RequireCompanyAccess(module: AccessModule.Inventory, approve: true)]
    public async Task<ActionResult<StockSettingsResponse>> SaveSettings(Guid companyId, SaveStockSettingsRequest request)
    {
        var settings = await _stock.SettingsAsync(companyId);
        if (request.DefaultWarehouseId is { } warehouseId
            && !await _db.Warehouses.AnyAsync(w => w.Id == warehouseId && w.CompanyId == companyId && w.IsActive))
        {
            return BadRequest(_localizer["WarehouseNotFound"].Value);
        }
        settings.NegativeStock = request.NegativeStock;
        settings.DefaultWarehouseId = request.DefaultWarehouseId ?? settings.DefaultWarehouseId;
        settings.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return await Settings(companyId);
    }

    // ---- Stock levels ----

    // Every stock-tracked item with quantity per warehouse, average cost and value. ?belowMinimum=true
    // is the low-stock report.
    [HttpGet("stock", Name = "ListStockLevels")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<PaginatedResponse<StockLevelResponse>>> Stock(Guid companyId,
        [FromQuery] string? search = null, [FromQuery] Guid? warehouseId = null, [FromQuery] Guid? categoryId = null,
        [FromQuery] bool belowMinimum = false, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var items = _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.TrackInventory && i.Type == ItemType.Goods);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            items = items.Where(i => EF.Functions.ILike(i.Name, pattern) || EF.Functions.ILike(i.Code.ToString(), pattern));
        }
        if (categoryId is { } c) items = items.Where(i => i.CategoryId == c);
        if (belowMinimum)
        {
            items = items.Where(i => i.MinimumStock != null
                && (_db.ItemCosts.Where(k => k.ItemId == i.Id).Select(k => (decimal?)k.Quantity).FirstOrDefault() ?? 0) < i.MinimumStock);
        }

        var total = await items.CountAsync();
        var page_ = await items.OrderBy(i => i.Code).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var ids = page_.Select(i => i.Id).ToList();
        var costs = await _db.ItemCosts.AsNoTracking().Where(k => ids.Contains(k.ItemId)).ToDictionaryAsync(k => k.ItemId);
        var locations = await _db.StockLocations.AsNoTracking().Where(l => l.CompanyId == companyId && l.WarehouseId != null && l.Usage == LocationUsage.Internal)
            .ToDictionaryAsync(l => l.Id, l => l.WarehouseId!.Value);
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => w.CompanyId == companyId).ToDictionaryAsync(w => w.Id, w => w.Name);
        var balances = await _db.StockBalances.AsNoTracking().Where(b => ids.Contains(b.ItemId)).ToListAsync();
        var categoryIds = page_.Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToList();
        var categories = await _db.ItemCategories.AsNoTracking().Where(k => categoryIds.Contains(k.Id)).ToDictionaryAsync(k => k.Id, k => k.Name);
        var suppliers = await UsualSuppliersAsync(companyId, ids);

        var rows = page_.Select(i =>
        {
            var cost = costs.GetValueOrDefault(i.Id);
            var perWarehouse = balances.Where(b => b.ItemId == i.Id && locations.ContainsKey(b.LocationId))
                .Select(b => new WarehouseQuantityResponse(locations[b.LocationId], warehouses.GetValueOrDefault(locations[b.LocationId]) ?? "?", b.Quantity))
                .Where(w => w.Quantity != 0 || w.WarehouseId == warehouseId).ToList();
            var quantity = warehouseId is { } wid ? perWarehouse.Where(w => w.WarehouseId == wid).Sum(w => w.Quantity) : cost?.Quantity ?? 0m;
            var average = cost?.AverageCost ?? 0m;
            var value = warehouseId is null ? cost?.Value ?? 0m : AverageCost.Money(quantity * average);
            var onHand = cost?.Quantity ?? 0m;
            var hasSupplier = suppliers.TryGetValue(i.Id, out var supplier);
            return new StockLevelResponse(i.Id, i.Code, i.Name, i.Unit, i.CategoryId is { } k ? categories.GetValueOrDefault(k) : null,
                quantity, average, value, i.MinimumStock, i.MinimumStock is { } min && onHand < min, perWarehouse,
                hasSupplier ? supplier.Id : null, hasSupplier ? supplier.Name : null,
                i.MinimumStock is { } m && onHand < m ? m - onHand : null);
        }).ToList();
        return Ok(new PaginatedResponse<StockLevelResponse>(rows, total, page, pageSize));
    }

    // The vendor each item was last bought from (latest posted purchase bill). Empty for callers
    // who can't see purchases; partner-scoped callers only see their own vendors.
    private async Task<Dictionary<Guid, (Guid Id, string Name)>> UsualSuppliersAsync(Guid companyId, List<Guid> itemIds)
    {
        if (_access.LevelFor(AccessModule.Purchases) < AccessLevel.Read) return new();
        var latest = await _db.BillLines.AsNoTracking()
            .Where(l => l.ItemId != null && itemIds.Contains(l.ItemId.Value) && l.Bill!.CompanyId == companyId
                && l.Bill.State == Pako.Domain.Bills.BillState.Posted && l.Bill.DocumentType == Pako.Domain.Bills.DocumentType.Bill)
            .Select(l => new { ItemId = l.ItemId!.Value, l.Bill!.PartnerId, l.Bill.IssueDate, l.Bill.CreatedAt })
            .ToListAsync();
        var byItem = latest.Where(l => _access.CanSeePartner(l.PartnerId))
            .GroupBy(l => l.ItemId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(l => l.IssueDate).ThenByDescending(l => l.CreatedAt).First().PartnerId);
        var partnerIds = byItem.Values.Distinct().ToList();
        var names = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return byItem.ToDictionary(kv => kv.Key, kv => (kv.Value, names.GetValueOrDefault(kv.Value) ?? "?"));
    }

    // Quantity on hand per item in one warehouse, for the item picker on invoices and bills. Needs
    // only Sales or Purchases access: quantities, never cost.
    [HttpGet("on-hand", Name = "GetStockOnHand")]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<StockOnHandResponse>>> OnHand(Guid companyId, [FromQuery] Guid[] itemIds, [FromQuery] Guid? warehouseId = null)
    {
        if (itemIds.Length == 0) return Ok(new List<StockOnHandResponse>());
        var location = warehouseId is { } w
            ? await _db.StockLocations.AsNoTracking().FirstOrDefaultAsync(l => l.CompanyId == companyId && l.WarehouseId == w && l.Usage == LocationUsage.Internal)
            : await DefaultLocationAsync(companyId);
        var tracked = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id) && i.CompanyId == companyId && i.TrackInventory)
            .Select(i => i.Id).ToListAsync();
        var balances = location is null
            ? new Dictionary<Guid, decimal>()
            : await _db.StockBalances.AsNoTracking().Where(b => b.LocationId == location.Id && tracked.Contains(b.ItemId)).ToDictionaryAsync(b => b.ItemId, b => b.Quantity);
        return Ok(tracked.Select(id => new StockOnHandResponse(id, balances.GetValueOrDefault(id), Math.Max(0, balances.GetValueOrDefault(id)))).ToList());
    }

    private async Task<StockLocation?> DefaultLocationAsync(Guid companyId)
    {
        var defaultWarehouse = await _db.StockSettings.AsNoTracking().Where(s => s.CompanyId == companyId).Select(s => s.DefaultWarehouseId).FirstOrDefaultAsync();
        return defaultWarehouse is { } id
            ? await _db.StockLocations.AsNoTracking().FirstOrDefaultAsync(l => l.WarehouseId == id && l.Usage == LocationUsage.Internal)
            : null;
    }

    // ---- Item card (kartela e artikullit) ----

    [HttpGet("items/{itemId:guid}/card", Name = "GetItemCard")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<ItemCardResponse>> ItemCard(Guid companyId, Guid itemId, [FromQuery] DateOnly? from = null, [FromQuery] DateOnly? to = null)
    {
        var item = await _db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId);
        if (item is null) return NotFound();
        var opening = from is { } f
            ? await _db.StockMoves.AsNoTracking().Where(m => m.ItemId == itemId && m.Date < f).OrderByDescending(m => m.Date).ThenByDescending(m => m.Sequence).FirstOrDefaultAsync()
            : null;
        var query = _db.StockMoves.AsNoTracking().Where(m => m.ItemId == itemId);
        if (from is { } f2) query = query.Where(m => m.Date >= f2);
        if (to is { } t) query = query.Where(m => m.Date <= t);
        var moves = await query.OrderBy(m => m.Date).ThenBy(m => m.Sequence).Take(5000).ToListAsync();
        var locationNames = await _db.StockLocations.AsNoTracking().Where(l => l.CompanyId == companyId).ToDictionaryAsync(l => l.Id, l => l.Name);
        var rows = moves.Select(m => new ItemCardRowResponse(m.Id, m.Date, m.Kind, m.SourceType, m.SourceId, m.Reference,
            locationNames.GetValueOrDefault(m.FromLocationId) ?? "?", locationNames.GetValueOrDefault(m.ToLocationId) ?? "?",
            m.Kind == StockMoveKind.Receipt ? m.Quantity : 0m, m.Kind == StockMoveKind.Issue ? m.Quantity : 0m,
            m.UnitCost, m.Value, m.QtyAfter, m.AvgCostAfter, m.ValueAfter)).ToList();
        var last = moves.LastOrDefault();
        return Ok(new ItemCardResponse(item.Id, item.Code, item.Name, item.Unit, from, to,
            opening?.QtyAfter ?? 0m, opening?.ValueAfter ?? 0m, last?.QtyAfter ?? opening?.QtyAfter ?? 0m, last?.ValueAfter ?? opening?.ValueAfter ?? 0m, rows));
    }

    // ---- Valuation at a date, tied out to the ledger ----

    [HttpGet("valuation", Name = "GetStockValuation")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<StockValuationResponse>> Valuation(Guid companyId, [FromQuery(Name = "asOf")] DateOnly? asOfDate = null)
    {
        // No date = today.
        return Ok(await ValuationAtAsync(companyId, asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow)));
    }

    private async Task<StockValuationResponse> ValuationAtAsync(Guid companyId, DateOnly asOf)
    {
        // The last move on or before the date carries each item's totals (D10).
        var lastMoves = await _db.StockMoves.AsNoTracking()
            .Where(m => m.CompanyId == companyId && m.Date <= asOf)
            .GroupBy(m => m.ItemId)
            .Select(g => g.OrderByDescending(m => m.Date).ThenByDescending(m => m.Sequence).First())
            .ToListAsync();
        var itemIds = lastMoves.Select(m => m.ItemId).ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var accounts = await _stock.InventoryAccountsForAsync(companyId, items.Values);
        var rows = lastMoves.Where(m => m.QtyAfter != 0 || m.ValueAfter != 0).Select(m => new StockValuationRowResponse(m.ItemId,
            items[m.ItemId].Code, items[m.ItemId].Name, items[m.ItemId].Unit, m.QtyAfter, m.AvgCostAfter, m.ValueAfter))
            .OrderBy(r => r.ItemCode).ToList();

        // An item whose stock account can't be resolved is valued but tied to no ledger account.
        var stockByAccount = lastMoves.Where(m => accounts[m.ItemId] != null).GroupBy(m => accounts[m.ItemId]!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(m => m.ValueAfter));
        var accountIds = stockByAccount.Keys.ToList();
        var ledger = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => accountIds.Contains(l.AccountId) && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State != Pako.Domain.Ledger.JournalEntryState.Draft && l.JournalEntry.Date <= asOf)
            .GroupBy(l => l.AccountId).Select(g => new { g.Key, Balance = g.Sum(l => l.Debit - l.Credit) })
            .ToDictionaryAsync(g => g.Key, g => g.Balance);
        var accountRows = await _db.Accounts.AsNoTracking().Where(a => accountIds.Contains(a.Id)).OrderBy(a => a.Code)
            .Select(a => new { a.Id, a.Code, a.Name }).ToListAsync();
        var accountResponses = accountRows.Select(a => new StockValuationAccountResponse(a.Id, a.Code, a.Name,
            stockByAccount.GetValueOrDefault(a.Id), ledger.GetValueOrDefault(a.Id))).ToList();
        var stockValue = rows.Sum(r => r.Value);
        var ledgerValue = accountResponses.Sum(a => a.LedgerValue);
        // Phase 2: write-downs to net realisable value sit on the 120900 allowance (a credit balance).
        var allowanceId = await _stock.AccountIdByCodeAsync(companyId, StockService.WriteDownAllowanceCode);
        var allowance = allowanceId is { } aid
            ? await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.AccountId == aid && l.JournalEntry!.CompanyId == companyId
                    && l.JournalEntry.State != Pako.Domain.Ledger.JournalEntryState.Draft && l.JournalEntry.Date <= asOf)
                .SumAsync(l => l.Credit - l.Debit)
            : 0m;
        return new StockValuationResponse(asOf, stockValue, ledgerValue, ledgerValue - stockValue, rows, accountResponses,
            allowance, stockValue - allowance);
    }

    // ---- Lots and expiry (§12 P8) ----

    // Lots on hand, the earliest expiry first. ?expiringBefore= keeps lots expiring on or before the
    // date (the expired included) — the list to pull from the shelf and write off.
    [HttpGet("lots", Name = "ListLotStock")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<List<LotStockResponse>>> Lots(Guid companyId, [FromQuery] Guid? itemId = null,
        [FromQuery] Guid? warehouseId = null, [FromQuery] DateOnly? expiringBefore = null)
    {
        var locations = await _db.StockLocations.AsNoTracking()
            .Where(l => l.CompanyId == companyId && l.WarehouseId != null && l.Usage == LocationUsage.Internal)
            .ToDictionaryAsync(l => l.Id, l => l.WarehouseId!.Value);
        var query = from b in _db.LotBalances.AsNoTracking()
                    join lot in _db.Lots.AsNoTracking() on b.LotId equals lot.Id
                    where b.CompanyId == companyId && b.Quantity > 0
                    select new { b.LocationId, b.Quantity, Lot = lot };
        if (itemId is { } item) query = query.Where(x => x.Lot.ItemId == item);
        if (expiringBefore is { } before) query = query.Where(x => x.Lot.ExpiryDate != null && x.Lot.ExpiryDate <= before);
        var rows = (await query.ToListAsync()).Where(x => locations.ContainsKey(x.LocationId)).ToList();
        if (warehouseId is { } w) rows = rows.Where(x => locations[x.LocationId] == w).ToList();

        var itemIds = rows.Select(r => r.Lot.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var costs = await _db.ItemCosts.AsNoTracking().Where(c => itemIds.Contains(c.ItemId)).ToDictionaryAsync(c => c.ItemId, c => c.AverageCost);
        var warehouses = await _db.Warehouses.AsNoTracking().Where(x => x.CompanyId == companyId).ToDictionaryAsync(x => x.Id, x => x.Name);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return Ok(rows.Select(r =>
        {
            var i = items[r.Lot.ItemId];
            var wid = locations[r.LocationId];
            return new LotStockResponse(r.Lot.Id, r.Lot.Number, r.Lot.ExpiryDate, r.Lot.ExpiryDate is { } e ? e.DayNumber - today.DayNumber : null,
                i.Id, i.Code, i.Name, i.Unit, wid, warehouses.GetValueOrDefault(wid) ?? "?", r.Quantity,
                AverageCost.Money(r.Quantity * costs.GetValueOrDefault(i.Id)));
        }).OrderBy(r => r.ExpiryDate ?? DateOnly.MaxValue).ThenBy(r => r.ItemCode).ThenBy(r => r.LotNumber).ToList());
    }

    // ---- Goods received, not invoiced (§12 P6) ----

    [HttpGet("grni", Name = "GetGrniReport")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<GrniReportResponse>> Grni(Guid companyId, [FromQuery(Name = "asOf")] DateOnly? asOfDate = null)
    {
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var lines = await _db.StockDocumentLines.AsNoTracking()
            .Where(l => l.StockDocument!.CompanyId == companyId && l.StockDocument.Type == StockDocumentType.Receipt
                && l.StockDocument.State == StockDocumentState.Posted && l.StockDocument.Date <= asOf)
            .Select(l => new { l.Id, l.ItemId, l.Quantity, l.UnitCost, l.StockDocumentId, l.StockDocument!.Number, l.StockDocument.Date, l.StockDocument.PartnerId })
            .ToListAsync();
        var ids = lines.Select(l => l.Id).ToList();
        // Only bills dated on or before the date count as matched then.
        var matched = await _db.ReceiptMatches.AsNoTracking()
            .Where(m => ids.Contains(m.ReceiptLineId) && _db.Bills.Any(b => b.Id == m.BillId && b.IssueDate <= asOf))
            .GroupBy(m => m.ReceiptLineId).Select(g => new { g.Key, Quantity = g.Sum(m => m.Quantity), Value = g.Sum(m => m.Value) })
            .ToDictionaryAsync(g => g.Key);
        var itemIds = lines.Select(l => l.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var partnerIds = lines.Where(l => l.PartnerId != null).Select(l => l.PartnerId!.Value).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);

        var rows = lines.Select(l =>
        {
            var m = matched.GetValueOrDefault(l.Id);
            var billed = m?.Quantity ?? 0m;
            var open = l.Quantity - billed;
            // Open value is the receipt value less what bills took off 120800, so it ties to the ledger.
            var value = AverageCost.Money(l.Quantity * (l.UnitCost ?? 0m)) - (m?.Value ?? 0m);
            var item = items.GetValueOrDefault(l.ItemId);
            return new GrniRowResponse(l.StockDocumentId, l.Number, l.Date, l.PartnerId ?? Guid.Empty,
                l.PartnerId is { } p ? partners.GetValueOrDefault(p) ?? "?" : "?", l.ItemId, item?.Code ?? 0, item?.Name ?? "?",
                l.Quantity, billed, open, l.UnitCost ?? 0m, value, asOf.DayNumber - l.Date.DayNumber);
        }).Where(r => r.Open > 0 || r.OpenValue != 0).OrderBy(r => r.Date).ThenBy(r => r.ReceiptNumber).ToList();

        var grniId = await _stock.AccountIdByCodeAsync(companyId, StockService.GoodsReceivedNotInvoicedCode);
        var ledger = grniId is { } gid
            ? await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.AccountId == gid && l.JournalEntry!.CompanyId == companyId
                    && l.JournalEntry.State != Pako.Domain.Ledger.JournalEntryState.Draft && l.JournalEntry.Date <= asOf)
                .SumAsync(l => l.Credit - l.Debit)
            : 0m;
        var openValue = rows.Sum(r => r.OpenValue);
        return Ok(new GrniReportResponse(asOf, openValue, ledger, ledger - openValue, rows));
    }

    // ---- Year end ----

    [HttpGet("year-end-check", Name = "GetStockYearEndCheck")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<StockYearEndCheckResponse>> YearEndCheck(Guid companyId, [FromQuery] int year)
    {
        if (year < 2000 || year > 2100) return BadRequest(_localizer["DashboardInvalidPeriod"].Value);
        var start = new DateOnly(year, 1, 1);
        var end = new DateOnly(year, 12, 31);
        var tracks = await _db.StockMoves.AnyAsync(m => m.CompanyId == companyId && m.Date <= end);

        var counts = await _db.StockDocuments.AsNoTracking()
            .Where(d => d.CompanyId == companyId && d.Type == StockDocumentType.Count && d.State == StockDocumentState.Posted
                && d.Date >= start && d.Date <= end)
            .Select(d => new { d.WarehouseId, d.Date, d.Number })
            .ToListAsync();
        // A warehouse needs a count when it held stock at some point in the year.
        var locations = await _db.StockLocations.AsNoTracking()
            .Where(l => l.CompanyId == companyId && l.WarehouseId != null && l.Usage == LocationUsage.Internal)
            .ToDictionaryAsync(l => l.Id, l => l.WarehouseId!.Value);
        var used = (await _db.StockMoves.AsNoTracking()
                .Where(m => m.CompanyId == companyId && m.Date <= end)
                .Select(m => new { m.FromLocationId, m.ToLocationId })
                .Distinct()
                .ToListAsync())
            .SelectMany(m => new[] { m.FromLocationId, m.ToLocationId })
            .Where(locations.ContainsKey).Select(l => locations[l]).ToHashSet();
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => w.CompanyId == companyId && used.Contains(w.Id))
            .OrderBy(w => w.Code).ToListAsync();
        var rows = warehouses.Select(w =>
        {
            var last = counts.Where(k => k.WarehouseId == w.Id).OrderByDescending(k => k.Date).FirstOrDefault();
            return new YearEndWarehouseCount(w.Id, w.Name, last?.Date, last?.Number);
        }).ToList();

        var valuation = await ValuationAtAsync(companyId, end);
        return Ok(new StockYearEndCheckResponse(year, tracks, rows,
            rows.Where(r => r.LastCountDate is null).Select(r => r.WarehouseName).ToList(),
            valuation.StockValue, valuation.LedgerValue, valuation.Difference));
    }

    // ---- Gross margin ----

    // Net sales of stock-tracked lines on posted invoices and sales returns, against the cost of
    // goods sold their stock moves recorded. ?groupBy=item|customer|month.
    [HttpGet("margin", Name = "GetMarginReport")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<MarginReportResponse>> Margin(Guid companyId, [FromQuery(Name = "from")] DateOnly? fromDate = null,
        [FromQuery(Name = "to")] DateOnly? toDate = null, [FromQuery] string groupBy = "item")
    {
        // No period = this month so far.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = fromDate ?? new DateOnly(today.Year, today.Month, 1);
        var to = toDate ?? today;
        if (from > to) return BadRequest(_localizer["DashboardInvalidPeriod"].Value);
        return Ok(await _reports.MarginAsync(companyId, from, to, groupBy));
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
