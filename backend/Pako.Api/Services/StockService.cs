using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/INVENTORY_PLAN.md — the one place stock moves are written. Documents (bills, invoices, stock
// documents) describe what moved; this service values it with weighted average cost
// (Pako.Domain.Inventory.AverageCost), keeps the balances, enforces the negative-stock policy and,
// for a back-dated document, replays the item's later moves so every cost stays right. It never
// writes journal entries: it returns values and corrections, and the document posts them in its own
// entry, so a document and its stock always land in one transaction.
public class StockService
{
    // Standard Kosovo chart codes (Plani Kontabel v2.0) used when neither item nor category says.
    public const string InventoryAccountCode = "120100";
    public const string CogsAccountCode = "500100";
    public const string ShortageAccountCode = "520100";
    public const string OverageAccountCode = "520200";
    public const string ScrapAccountCode = "520300";
    // Phase 2: the contra-asset carrying write-downs to net realisable value (IAS 2).
    public const string WriteDownAllowanceCode = "120900";
    // §12 P6: goods received, not yet invoiced (credit balance until the bill arrives).
    public const string GoodsReceivedNotInvoicedCode = "120800";
    // docs/INVENTORY_PLAN.md D3: created on first use, not part of the standard 233-account chart.
    public const string OpeningClearingAccountCode = "390100";

    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public StockService(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    // ---- Setup: settings, warehouses, locations, accounts ----

    public async Task<StockSettings> SettingsAsync(Guid companyId)
    {
        // Look at what this request already added (not yet saved) before the database.
        var settings = _db.StockSettings.Local.FirstOrDefault(s => s.CompanyId == companyId)
            ?? await _db.StockSettings.FirstOrDefaultAsync(s => s.CompanyId == companyId);
        if (settings is not null) return settings;
        settings = new StockSettings { CompanyId = companyId };
        _db.StockSettings.Add(settings);
        return settings;
    }

    // The company's default warehouse, creating "Magazina kryesore" the first time stock is used.
    public async Task<Warehouse> DefaultWarehouseAsync(Guid companyId)
    {
        var settings = await SettingsAsync(companyId);
        if (settings.DefaultWarehouseId is { } id)
        {
            var existing = await _db.Warehouses.FirstOrDefaultAsync(w => w.Id == id && w.CompanyId == companyId);
            if (existing is not null) return existing;
        }

        var first = await _db.Warehouses.Where(w => w.CompanyId == companyId && w.IsActive).OrderBy(w => w.CreatedAt).FirstOrDefaultAsync()
            ?? _db.Warehouses.Local.FirstOrDefault(w => w.CompanyId == companyId);
        if (first is null)
        {
            first = await CreateWarehouseAsync(companyId, "MAIN", "Magazina kryesore", null);
        }
        settings.DefaultWarehouseId = first.Id;
        return first;
    }

    public async Task<Warehouse> CreateWarehouseAsync(Guid companyId, string code, string name, string? address)
    {
        var warehouse = new Warehouse { Id = Guid.NewGuid(), CompanyId = companyId, Code = code, Name = name, Address = address };
        _db.Warehouses.Add(warehouse);
        _db.StockLocations.Add(new StockLocation
        {
            Id = Guid.NewGuid(), CompanyId = companyId, WarehouseId = warehouse.Id, Name = name, Usage = LocationUsage.Internal
        });
        await Task.CompletedTask;
        return warehouse;
    }

    public async Task<StockLocation> StockLocationAsync(Guid companyId, Guid warehouseId)
    {
        var location = _db.StockLocations.Local.FirstOrDefault(l => l.WarehouseId == warehouseId && l.Usage == LocationUsage.Internal)
            ?? await _db.StockLocations.FirstOrDefaultAsync(l => l.CompanyId == companyId && l.WarehouseId == warehouseId && l.Usage == LocationUsage.Internal);
        if (location is not null) return location;
        location = new StockLocation { Id = Guid.NewGuid(), CompanyId = companyId, WarehouseId = warehouseId, Name = "Stock", Usage = LocationUsage.Internal };
        _db.StockLocations.Add(location);
        return location;
    }

    // One virtual location per counterpart per company (supplier, customer, opening, adjustment, scrap).
    public async Task<StockLocation> VirtualLocationAsync(Guid companyId, LocationUsage usage)
    {
        var location = _db.StockLocations.Local.FirstOrDefault(l => l.CompanyId == companyId && l.Usage == usage && l.WarehouseId == null)
            ?? await _db.StockLocations.FirstOrDefaultAsync(l => l.CompanyId == companyId && l.Usage == usage && l.WarehouseId == null);
        if (location is not null) return location;
        location = new StockLocation { Id = Guid.NewGuid(), CompanyId = companyId, Name = usage.ToString(), Usage = usage };
        _db.StockLocations.Add(location);
        return location;
    }

    // The accounts a stock item posts to: the item's own, then its category's, then the standard
    // chart account (D9). Revenue and expense keep their existing resolution in the documents.
    public record ItemAccounts(Guid InventoryAccountId, Guid CogsAccountId);

    public async Task<Dictionary<Guid, ItemAccounts>> AccountsForAsync(Guid companyId, IEnumerable<Item> items)
    {
        var list = items.DistinctBy(i => i.Id).ToList();
        var categoryIds = list.Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToList();
        var categories = await _db.ItemCategories.AsNoTracking().Where(c => categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        var inventoryDefault = await AccountIdByCodeAsync(companyId, InventoryAccountCode);
        var cogsDefault = await AccountIdByCodeAsync(companyId, CogsAccountCode);

        var result = new Dictionary<Guid, ItemAccounts>();
        foreach (var item in list)
        {
            var category = item.CategoryId is { } c ? categories.GetValueOrDefault(c) : null;
            var inventory = item.DefaultInventoryAccountId ?? category?.InventoryAccountId ?? inventoryDefault;
            var cogs = category?.CogsAccountId ?? cogsDefault;
            // An item expense account set to a cost-of-sales account (class 5) is its COGS override.
            if (item.DefaultExpenseAccountId is { } expense && await IsClassAsync(expense, 5)) cogs = expense;
            if (inventory is null || cogs is null)
            {
                throw new StockException(string.Format(_localizer["StockAccountsMissing"].Value, item.Name));
            }
            result[item.Id] = new ItemAccounts(inventory.Value, cogs.Value);
        }
        return result;
    }

    // Same, but items whose accounts can't be resolved are left out instead of refusing (used while
    // drafting, where posting will report the missing account).
    public async Task<Dictionary<Guid, ItemAccounts>> AccountsForSafeAsync(Guid companyId, IEnumerable<Item> items)
    {
        try
        {
            return await AccountsForAsync(companyId, items);
        }
        catch (StockException)
        {
            return new Dictionary<Guid, ItemAccounts>();
        }
    }

    public async Task<Guid?> AccountIdByCodeAsync(Guid companyId, string code) =>
        await _db.Accounts.AsNoTracking().Where(a => a.CompanyId == companyId && a.Code == code && a.IsActive)
            .Select(a => (Guid?)a.Id).FirstOrDefaultAsync();

    private async Task<bool> IsClassAsync(Guid accountId, int accountClass) =>
        await _db.Accounts.AsNoTracking().AnyAsync(a => a.Id == accountId && a.Class == accountClass);

    public async Task<Guid> RequiredAccountAsync(Guid companyId, string code) =>
        await AccountIdByCodeAsync(companyId, code)
        ?? throw new StockException(string.Format(_localizer["StockAccountCodeMissing"].Value, code));

    // D3: the opening-balance clearing account, created the first time opening stock is posted.
    public async Task<Guid> OpeningClearingAccountAsync(Guid companyId)
    {
        var existing = await AccountIdByCodeAsync(companyId, OpeningClearingAccountCode);
        if (existing is { } id) return id;
        var account = new Account
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Code = OpeningClearingAccountCode,
            Name = "Opening Balance Clearing",
            NameSq = "Llogari e hapjes së bilancit (kliring)",
            AccountType = AccountType.Equity,
            Class = 3,
            Group = 39,
            Statement = AccountStatement.BalanceSheet,
            NormalBalance = NormalBalance.Credit,
            Subledger = SubledgerType.None,
            IsPostable = true,
        };
        _db.Accounts.Add(account);
        return account.Id;
    }

    // ---- Moving stock ----

    // What a document asks to move. Value: receipts and revaluations carry their own value; issues
    // and transfers are valued here.
    // §12 P8: LotNumber/ExpiryDate name the lot received into stock (required for items that track
    // lots) or the lot to take from (optional; the earliest expiry first otherwise).
    public record MoveRequest(Guid ItemId, StockMoveKind Kind, Guid FromLocationId, Guid ToLocationId, decimal Quantity,
        decimal? Value = null, Guid? SourceLineId = null, string? LotNumber = null, DateOnly? ExpiryDate = null);

    public record MoveOutcome(MoveRequest Request, StockMove Move, decimal Value, decimal Correction);

    // Per item: the change to cost of goods sold already booked by later documents, caused by
    // replaying them after a back-dated one (D11). Positive = more cost of goods sold.
    public record StockPosting(IReadOnlyList<MoveOutcome> Moves, IReadOnlyDictionary<Guid, decimal> ReplayCogsDelta);

    public async Task<StockPosting> ApplyAsync(Guid companyId, DateOnly date, StockMoveSource sourceType, Guid sourceId,
        string? reference, IReadOnlyList<MoveRequest> requests)
    {
        var outcomes = new List<MoveOutcome>();
        var replayDelta = new Dictionary<Guid, decimal>();
        if (requests.Count == 0) return new StockPosting(outcomes, replayDelta);

        var settings = await SettingsAsync(companyId);
        var itemIds = requests.Select(r => r.ItemId).Distinct().OrderBy(id => id).ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id) && i.CompanyId == companyId).ToDictionaryAsync(i => i.Id);
        var locationIds = requests.SelectMany(r => new[] { r.FromLocationId, r.ToLocationId }).Distinct().ToList();
        var locations = _db.StockLocations.Local.Where(l => locationIds.Contains(l.Id)).ToDictionary(l => l.Id);
        foreach (var l in await _db.StockLocations.AsNoTracking().Where(l => locationIds.Contains(l.Id)).ToListAsync())
        {
            locations.TryAdd(l.Id, l);
        }

        await LockItemsAsync(companyId, itemIds);

        foreach (var itemId in itemIds)
        {
            if (!items.TryGetValue(itemId, out var item)) throw new StockException(_localizer["StockItemNotFound"].Value);
            var itemRequests = requests.Where(r => r.ItemId == itemId).ToList();
            var (itemOutcomes, delta) = await ApplyItemAsync(companyId, item, date, sourceType, sourceId, reference, itemRequests, locations, settings);
            outcomes.AddRange(itemOutcomes);
            if (delta != 0) replayDelta[itemId] = delta;
        }

        // Keep the caller's order.
        var ordered = requests.Select(r => outcomes.First(o => ReferenceEquals(o.Request, r))).ToList();
        return new StockPosting(ordered, replayDelta);
    }

    // Serializes everything that moves the same items (Postgres only; tests on InMemory don't race).
    private async Task LockItemsAsync(Guid companyId, List<Guid> itemIds)
    {
        if (!_db.Database.SupportsRowLocking()) return;
        foreach (var itemId in itemIds)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO item_costs (\"ItemId\", \"CompanyId\", \"Quantity\", \"AverageCost\", \"Value\") VALUES ({itemId}, {companyId}, 0, 0, 0) ON CONFLICT (\"ItemId\") DO NOTHING");
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT \"ItemId\" FROM item_costs WHERE \"ItemId\" = {itemId} FOR UPDATE");
        }
    }

    private async Task<(List<MoveOutcome> Outcomes, decimal ReplayDelta)> ApplyItemAsync(Guid companyId, Item item, DateOnly date,
        StockMoveSource sourceType, Guid sourceId, string? reference, List<MoveRequest> requests,
        Dictionary<Guid, StockLocation> locations, StockSettings settings)
    {
        var cost = _db.ItemCosts.Local.FirstOrDefault(c => c.ItemId == item.Id)
            ?? await _db.ItemCosts.FirstOrDefaultAsync(c => c.ItemId == item.Id);
        if (cost is null)
        {
            cost = new ItemCost { CompanyId = companyId, ItemId = item.Id };
            _db.ItemCosts.Add(cost);
        }

        var backDated = cost.LastMoveDate is { } last && last > date;

        // Position just before the new moves: the item's current position, or — back-dated — the
        // position after the last move on or before the document's date.
        CostPosition position;
        List<StockMove> later = new();
        if (!backDated)
        {
            position = new CostPosition(cost.Quantity, cost.Value, cost.AverageCost);
        }
        else
        {
            var before = await _db.StockMoves.AsNoTracking()
                .Where(m => m.ItemId == item.Id && m.Date <= date)
                .OrderByDescending(m => m.Date).ThenByDescending(m => m.Sequence)
                .FirstOrDefaultAsync();
            position = before is null ? CostPosition.Empty : new CostPosition(before.QtyAfter, before.ValueAfter, before.AvgCostAfter);
            later = await _db.StockMoves.Where(m => m.ItemId == item.Id && m.Date > date)
                .OrderBy(m => m.Date).ThenBy(m => m.Sequence).ToListAsync();
        }

        await CheckNegativeStockAsync(item, requests, later, locations, settings);

        var outcomes = new List<MoveOutcome>();
        foreach (var request in requests)
        {
            var (result, unitCost) = Apply(position, request.Kind, request.Quantity, request.Value);
            position = result.After;
            var move = new StockMove
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Date = date,
                ItemId = item.Id,
                Kind = request.Kind,
                FromLocationId = request.FromLocationId,
                ToLocationId = request.ToLocationId,
                Quantity = request.Quantity,
                UnitCost = unitCost,
                Value = Math.Abs(result.MoveValue),
                ValueDelta = ValueDelta(request.Kind, result),
                Correction = result.Correction,
                QtyAfter = position.Quantity,
                AvgCostAfter = position.AverageCost,
                ValueAfter = position.Value,
                SourceType = sourceType,
                SourceId = sourceId,
                SourceLineId = request.SourceLineId,
                Reference = reference,
            };
            _db.StockMoves.Add(move);
            await UpdateBalancesAsync(companyId, item.Id, request, locations);
            await AllocateLotsAsync(companyId, item, request, move, locations);
            outcomes.Add(new MoveOutcome(request, move, result.MoveValue, result.Correction));
        }

        // D11: replay later moves from the new position. Quantities and sources never change; their
        // cost fields are recomputed, and what that changes in cost of goods sold already booked is
        // returned so the triggering document posts it as one correction.
        decimal replayDelta = 0;
        foreach (var move in later)
        {
            var (result, unitCost) = Apply(position, move.Kind, move.Quantity, move.Kind is StockMoveKind.Receipt or StockMoveKind.Revaluation ? move.ValueDelta : null);
            if (move.Kind == StockMoveKind.Issue) replayDelta += result.MoveValue - move.Value;
            replayDelta += result.Correction - move.Correction;
            position = result.After;
            move.UnitCost = unitCost;
            move.Value = Math.Abs(result.MoveValue);
            move.ValueDelta = ValueDelta(move.Kind, result);
            move.Correction = result.Correction;
            move.QtyAfter = position.Quantity;
            move.AvgCostAfter = position.AverageCost;
            move.ValueAfter = position.Value;
        }

        cost.Quantity = position.Quantity;
        cost.Value = position.Value;
        cost.AverageCost = position.AverageCost;
        if (cost.LastMoveDate is null || cost.LastMoveDate < date) cost.LastMoveDate = date;
        return (outcomes, replayDelta);
    }

    private static (CostResult Result, decimal UnitCost) Apply(CostPosition position, StockMoveKind kind, decimal quantity, decimal? value)
    {
        switch (kind)
        {
            case StockMoveKind.Receipt:
                {
                    var r = AverageCost.Receive(position, quantity, value ?? AverageCost.ValueOf(position, quantity));
                    return (r, AverageCost.UnitCost(r.MoveValue / quantity));
                }
            case StockMoveKind.Issue:
                {
                    var r = AverageCost.Issue(position, quantity);
                    return (r, AverageCost.UnitCost(r.MoveValue / quantity));
                }
            case StockMoveKind.Revaluation:
                return (AverageCost.Revalue(position, value ?? 0m), 0m);
            default:
                // A transfer changes neither company quantity nor value; it is shown at the average.
                return (new CostResult(position, AverageCost.ValueOf(position, quantity), 0m), position.AverageCost);
        }
    }

    private static decimal ValueDelta(StockMoveKind kind, CostResult result) => kind switch
    {
        StockMoveKind.Receipt => result.MoveValue,
        StockMoveKind.Issue => -result.MoveValue,
        StockMoveKind.Revaluation => result.MoveValue,
        _ => 0m
    };

    // ---- Lots (§12 P8) ----

    // Records which lots a move took from or added to and keeps each lot's quantity per location.
    // Into stock: the request must name the lot (created on first use, with its expiry). Out of
    // stock: the named lot, or the earliest expiry first; a transfer carries the same lots across.
    private async Task AllocateLotsAsync(Guid companyId, Item item, MoveRequest request, StockMove move, Dictionary<Guid, StockLocation> locations)
    {
        if (!item.TrackLots || request.Quantity <= 0 || request.Kind == StockMoveKind.Revaluation) return;
        var from = locations.GetValueOrDefault(request.FromLocationId);
        var to = locations.GetValueOrDefault(request.ToLocationId);
        var outOfStock = from?.IsStock == true;
        var intoStock = to?.IsStock == true;
        if (!outOfStock && !intoStock) return;

        List<(Lot Lot, decimal Quantity)> parts;
        if (outOfStock)
        {
            parts = await TakeLotsAsync(item, from!.Id, request.Quantity, request.LotNumber);
        }
        else
        {
            if (string.IsNullOrWhiteSpace(request.LotNumber))
            {
                throw new StockException(string.Format(_localizer["StockLotRequired"].Value, item.Name));
            }
            parts = new() { (await LotAsync(companyId, item.Id, request.LotNumber.Trim(), request.ExpiryDate), request.Quantity) };
        }

        foreach (var (lot, quantity) in parts)
        {
            _db.StockMoveLots.Add(new StockMoveLot { Id = Guid.NewGuid(), StockMoveId = move.Id, LotId = lot.Id, Quantity = quantity });
            if (outOfStock) (await LotBalanceAsync(companyId, lot, from!.Id)).Quantity -= quantity;
            if (intoStock) (await LotBalanceAsync(companyId, lot, to!.Id)).Quantity += quantity;
        }
    }

    private async Task<List<(Lot Lot, decimal Quantity)>> TakeLotsAsync(Item item, Guid locationId, decimal quantity, string? lotNumber)
    {
        await _db.Lots.Where(l => l.ItemId == item.Id).LoadAsync();
        await _db.LotBalances.Where(b => b.ItemId == item.Id && b.LocationId == locationId).LoadAsync();
        var lots = _db.Lots.Local.Where(l => l.ItemId == item.Id).ToDictionary(l => l.Id);
        var available = _db.LotBalances.Local.Where(b => b.ItemId == item.Id && b.LocationId == locationId && b.Quantity > 0 && lots.ContainsKey(b.LotId))
            .Select(b => (Lot: lots[b.LotId], b.Quantity))
            .OrderBy(x => x.Lot.ExpiryDate ?? DateOnly.MaxValue).ThenBy(x => x.Lot.CreatedAt).ThenBy(x => x.Lot.Number)
            .ToList();
        if (!string.IsNullOrWhiteSpace(lotNumber))
        {
            var chosen = available.Where(x => string.Equals(x.Lot.Number, lotNumber.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
            if (chosen.Sum(x => x.Quantity) < quantity)
            {
                throw new StockException(string.Format(_localizer["StockLotNotAvailable"].Value, lotNumber.Trim(), item.Name));
            }
            available = chosen;
        }

        var parts = new List<(Lot, decimal)>();
        var left = quantity;
        foreach (var (lot, onHand) in available)
        {
            if (left <= 0) break;
            var take = Math.Min(left, onHand);
            parts.Add((lot, take));
            left -= take;
        }
        // What no lot covers (selling below zero under "warn") moves without a lot.
        return parts;
    }

    private async Task<Lot> LotAsync(Guid companyId, Guid itemId, string number, DateOnly? expiry)
    {
        var lot = _db.Lots.Local.FirstOrDefault(l => l.ItemId == itemId && string.Equals(l.Number, number, StringComparison.OrdinalIgnoreCase))
            ?? await _db.Lots.FirstOrDefaultAsync(l => l.ItemId == itemId && l.Number.ToLower() == number.ToLower());
        if (lot is not null)
        {
            // A lot keeps the expiry it was first received with; an empty one can be filled in.
            lot.ExpiryDate ??= expiry;
            return lot;
        }
        lot = new Lot { Id = Guid.NewGuid(), CompanyId = companyId, ItemId = itemId, Number = number, ExpiryDate = expiry };
        _db.Lots.Add(lot);
        return lot;
    }

    private async Task<LotBalance> LotBalanceAsync(Guid companyId, Lot lot, Guid locationId)
    {
        var balance = _db.LotBalances.Local.FirstOrDefault(b => b.LotId == lot.Id && b.LocationId == locationId)
            ?? await _db.LotBalances.FirstOrDefaultAsync(b => b.LotId == lot.Id && b.LocationId == locationId);
        if (balance is not null) return balance;
        balance = new LotBalance { LotId = lot.Id, LocationId = locationId, CompanyId = companyId, ItemId = lot.ItemId };
        _db.LotBalances.Add(balance);
        return balance;
    }

    private async Task UpdateBalancesAsync(Guid companyId, Guid itemId, MoveRequest request, Dictionary<Guid, StockLocation> locations)
    {
        if (request.Quantity == 0) return;
        if (locations.TryGetValue(request.FromLocationId, out var from) && from.IsStock)
        {
            (await BalanceAsync(companyId, itemId, from.Id)).Quantity -= request.Quantity;
        }
        if (locations.TryGetValue(request.ToLocationId, out var to) && to.IsStock)
        {
            (await BalanceAsync(companyId, itemId, to.Id)).Quantity += request.Quantity;
        }
    }

    private async Task<StockBalance> BalanceAsync(Guid companyId, Guid itemId, Guid locationId)
    {
        var balance = _db.StockBalances.Local.FirstOrDefault(b => b.ItemId == itemId && b.LocationId == locationId)
            ?? await _db.StockBalances.FirstOrDefaultAsync(b => b.ItemId == itemId && b.LocationId == locationId);
        if (balance is not null) return balance;
        balance = new StockBalance { CompanyId = companyId, ItemId = itemId, LocationId = locationId };
        _db.StockBalances.Add(balance);
        return balance;
    }

    // D2: under Block nothing may take a warehouse below zero — now, or, for a back-dated document,
    // at any point in the moves that follow it (ERPNext's "negative stock in future" check).
    private async Task CheckNegativeStockAsync(Item item, List<MoveRequest> requests, List<StockMove> later,
        Dictionary<Guid, StockLocation> locations, StockSettings settings)
    {
        if (settings.NegativeStock != NegativeStockPolicy.Block) return;
        var outgoing = requests.Where(r => r.Quantity > 0 && locations.TryGetValue(r.FromLocationId, out var l) && l.IsStock)
            .Select(r => r.FromLocationId).Distinct().ToList();
        if (outgoing.Count == 0) return;

        foreach (var locationId in outgoing)
        {
            var current = (_db.StockBalances.Local.FirstOrDefault(b => b.ItemId == item.Id && b.LocationId == locationId)
                ?? await _db.StockBalances.AsNoTracking().FirstOrDefaultAsync(b => b.ItemId == item.Id && b.LocationId == locationId))?.Quantity ?? 0m;
            // Balance at the document's date = today's balance minus everything that happened later.
            decimal Effect(Guid from, Guid to, decimal qty) => (to == locationId ? qty : 0m) - (from == locationId ? qty : 0m);
            var running = current - later.Sum(m => Effect(m.FromLocationId, m.ToLocationId, m.Quantity));
            foreach (var r in requests)
            {
                running += Effect(r.FromLocationId, r.ToLocationId, r.Quantity);
                if (running < 0) throw Negative(item, locations[locationId], running + r.Quantity);
            }
            foreach (var m in later)
            {
                running += Effect(m.FromLocationId, m.ToLocationId, m.Quantity);
                if (running < 0) throw new StockException(string.Format(_localizer["StockWouldGoNegativeLater"].Value, item.Name, m.Date));
            }
        }
    }

    private StockException Negative(Item item, StockLocation location, decimal available) =>
        new(string.Format(_localizer["StockNotEnough"].Value, item.Name, Math.Max(0, available), location.Name));

    // ---- Helpers for documents that post stock ----

    // The stock-tracked Goods items among a document's lines (D5, D8: untracked items and
    // Service/Normative items never move stock).
    public async Task<Dictionary<Guid, Item>> TrackedItemsAsync(Guid companyId, IEnumerable<Guid?> itemIds)
    {
        var ids = itemIds.Where(id => id != null).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<Guid, Item>();
        return await _db.Items.AsNoTracking()
            .Where(i => ids.Contains(i.Id) && i.CompanyId == companyId && i.TrackInventory && i.Type == ItemType.Goods)
            .ToDictionaryAsync(i => i.Id);
    }

    // The stock location of the document's warehouse (or the company default).
    public async Task<StockLocation> DocumentLocationAsync(Guid companyId, Guid? warehouseId)
    {
        Warehouse warehouse;
        if (warehouseId is { } id)
        {
            warehouse = await _db.Warehouses.FirstOrDefaultAsync(w => w.Id == id && w.CompanyId == companyId && w.IsActive)
                ?? throw new StockException(_localizer["WarehouseNotFound"].Value);
        }
        else
        {
            warehouse = await DefaultWarehouseAsync(companyId);
        }
        return await StockLocationAsync(companyId, warehouse.Id);
    }

    // Adds a balanced Dr/Cr pair to a document's own journal entry (already validated and balanced;
    // a pair keeps it balanced, one-sided and non-negative). Zero is skipped; a negative amount
    // swaps the sides.
    // §12 P7: the factor for a unit entered on a document line. Null or the item's base unit = 1;
    // its purchase or sales unit = that unit's factor; anything else is not a unit of the item.
    public static (string? Name, decimal Factor)? ResolveUnit(Item? item, string? unitName)
    {
        var name = string.IsNullOrWhiteSpace(unitName) ? null : unitName.Trim();
        if (name is null || item is null || string.Equals(name, item.Unit, StringComparison.OrdinalIgnoreCase)) return (null, 1m);
        if (item.PurchaseUnitFactor is { } pf && string.Equals(name, item.PurchaseUnit, StringComparison.OrdinalIgnoreCase)) return (item.PurchaseUnit, pf);
        if (item.SalesUnitFactor is { } sf && string.Equals(name, item.SalesUnit, StringComparison.OrdinalIgnoreCase)) return (item.SalesUnit, sf);
        return null;
    }

    public static void AddPair(JournalEntry entry, Guid debitAccountId, Guid creditAccountId, decimal amount, string description)
    {
        amount = AverageCost.Money(amount);
        if (amount == 0) return;
        if (amount < 0)
        {
            (debitAccountId, creditAccountId) = (creditAccountId, debitAccountId);
            amount = -amount;
        }
        entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = debitAccountId, Debit = amount, Description = description });
        entry.Lines.Add(new JournalEntryLine { Id = Guid.NewGuid(), AccountId = creditAccountId, Credit = amount, Description = description });
    }

    // Posts the cost-of-goods-sold side of corrections: Correction > 0 = Dr COGS / Cr Inventory,
    // plus each item's back-date replay delta (D11).
    public static void AddCorrections(JournalEntry entry, StockPosting posting, IReadOnlyDictionary<Guid, ItemAccounts> accounts,
        IEnumerable<(Guid ItemId, decimal Amount)> extraCorrections, string description)
    {
        foreach (var (itemId, amount) in extraCorrections)
        {
            AddPair(entry, accounts[itemId].CogsAccountId, accounts[itemId].InventoryAccountId, amount, description);
        }
        foreach (var (itemId, delta) in posting.ReplayCogsDelta)
        {
            AddPair(entry, accounts[itemId].CogsAccountId, accounts[itemId].InventoryAccountId, delta, description);
        }
    }

    // ---- Reading ----

    // Quantity of each item in one location at the end of a date (the book quantity a count
    // compares against).
    public async Task<Dictionary<Guid, decimal>> QuantitiesAtAsync(Guid locationId, List<Guid> itemIds, DateOnly date)
    {
        var moves = await _db.StockMoves.AsNoTracking()
            .Where(m => itemIds.Contains(m.ItemId) && m.Date <= date && (m.FromLocationId == locationId || m.ToLocationId == locationId))
            .GroupBy(m => m.ItemId)
            .Select(g => new
            {
                g.Key,
                In = g.Where(m => m.ToLocationId == locationId).Sum(m => m.Quantity),
                Out = g.Where(m => m.FromLocationId == locationId).Sum(m => m.Quantity),
            })
            .ToListAsync();
        return moves.ToDictionary(m => m.Key, m => m.In - m.Out);
    }

    public async Task<decimal> OnHandAsync(Guid itemId, Guid locationId) =>
        (await _db.StockBalances.AsNoTracking().FirstOrDefaultAsync(b => b.ItemId == itemId && b.LocationId == locationId))?.Quantity ?? 0m;

    // The stock valuation accounts in use: manual journal entries to them are refused, so the
    // ledger and the stock report can't drift apart (D-§5.3).
    public async Task<HashSet<Guid>> StockAccountIdsInUseAsync(Guid companyId)
    {
        var tracked = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.TrackInventory).ToListAsync();
        if (tracked.Count == 0) return new HashSet<Guid>();
        var accounts = await AccountsForAsync(companyId, tracked);
        return accounts.Values.Select(a => a.InventoryAccountId).ToHashSet();
    }
}

// A stock rule refused the document; the message is user-facing (localized).
public class StockException : Exception
{
    public StockException(string message) : base(message) { }
}
