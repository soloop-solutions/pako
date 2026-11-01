using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Inventory;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/INVENTORY_PLAN.md §12 P4 — which price applies, and the price-change document (Nivelim).
// A price is resolved shop first: the warehouse's own list, then the company-wide list, then the
// item's default price. On each list the latest price valid on the day wins.
public class PriceListService
{
    private readonly PakoDbContext _db;
    private readonly StockService _stock;
    private readonly NumberSeriesService _numbers;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PriceListService(PakoDbContext db, StockService stock, NumberSeriesService numbers, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _stock = stock;
        _numbers = numbers;
        _localizer = localizer;
    }

    // Each item's latest ordinary price (tier 0) on one list valid on the date.
    public async Task<Dictionary<Guid, PriceListPrice>> PricesOnAsync(Guid priceListId, DateOnly date, IReadOnlyCollection<Guid>? itemIds = null)
    {
        var query = _db.PriceListPrices.AsNoTracking().Where(p => p.PriceListId == priceListId && p.ValidFrom <= date && p.MinQuantity == 0);
        if (itemIds is not null) query = query.Where(p => itemIds.Contains(p.ItemId));
        var prices = await query.ToListAsync();
        return prices.GroupBy(p => p.ItemId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.ValidFrom).ThenByDescending(p => p.CreatedAt).First());
    }

    // docs/POS_PLAN.md P6: each item's volume tiers on one list valid on the date — per tier the
    // latest price, lowest tier first.
    public async Task<Dictionary<Guid, List<PriceListPrice>>> TiersOnAsync(Guid priceListId, DateOnly date, IReadOnlyCollection<Guid> itemIds)
    {
        var prices = await _db.PriceListPrices.AsNoTracking()
            .Where(p => p.PriceListId == priceListId && p.ValidFrom <= date && p.MinQuantity > 0 && itemIds.Contains(p.ItemId)).ToListAsync();
        return prices.GroupBy(p => p.ItemId).ToDictionary(g => g.Key, g => g.GroupBy(p => p.MinQuantity)
            .Select(t => t.OrderByDescending(p => p.ValidFrom).ThenByDescending(p => p.CreatedAt).First())
            .OrderBy(p => p.MinQuantity).ToList());
    }

    // A price is resolved customer first (the partner's own list), then the shop (the store's or
    // warehouse's list), then the company list, then the item's default price. On a list, a volume
    // tier the quantity (base units) reaches beats the ordinary price.
    public async Task<List<ResolvedPriceResponse>> ResolveAsync(Guid companyId, Guid? warehouseId, DateOnly date, IReadOnlyCollection<Guid> itemIds,
        Guid? preferredListId = null, Guid? partnerId = null, IReadOnlyDictionary<Guid, decimal>? quantities = null)
    {
        var lists = await _db.PriceLists.AsNoTracking().Where(p => p.CompanyId == companyId && p.IsActive).ToListAsync();
        var customerListId = partnerId is { } pid
            ? await _db.Partners.AsNoTracking().Where(p => p.Id == pid && p.CompanyId == companyId).Select(p => p.PriceListId).FirstOrDefaultAsync()
            : null;
        var customer = customerListId is { } cl ? lists.FirstOrDefault(p => p.Id == cl && p.IsCustomerList) : null;
        // A POS store may name its own list; otherwise the warehouse's list.
        var shop = (preferredListId is { } preferred ? lists.FirstOrDefault(p => p.Id == preferred) : null)
            ?? (warehouseId is { } w ? lists.FirstOrDefault(p => p.WarehouseId == w && !p.IsCustomerList) : null);
        var company = lists.FirstOrDefault(p => p.WarehouseId == null && !p.IsCustomerList);
        var ordered = new List<(PriceList List, string Source)>();
        if (customer is not null) ordered.Add((customer, "customer"));
        if (shop is not null) ordered.Add((shop, "warehouse"));
        if (company is not null && company.Id != shop?.Id) ordered.Add((company, "company"));

        var prices = new List<(PriceList List, string Source, Dictionary<Guid, PriceListPrice> Base, Dictionary<Guid, List<PriceListPrice>> Tiers)>();
        foreach (var (list, source) in ordered)
        {
            prices.Add((list, source, await PricesOnAsync(list.Id, date, itemIds),
                quantities is null ? new() : await TiersOnAsync(list.Id, date, itemIds)));
        }
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);

        var result = new List<ResolvedPriceResponse>();
        foreach (var id in itemIds.Distinct())
        {
            var item = items.GetValueOrDefault(id);
            var quantity = quantities?.GetValueOrDefault(id) ?? 0m;
            var found = false;
            foreach (var (list, source, basePrices, tiers) in prices)
            {
                var tier = tiers.TryGetValue(id, out var t) ? t.LastOrDefault(x => x.MinQuantity <= quantity) : null;
                var price = tier ?? basePrices.GetValueOrDefault(id);
                if (price is null) continue;
                result.Add(new(id, price.Price, source, list.Id, UnitPrices(item, price.Price), tier?.MinQuantity));
                found = true;
                break;
            }
            if (!found && item?.DefaultUnitPrice is { } d) result.Add(new(id, d, "item", null, UnitPrices(item, d)));
        }
        return result;
    }

    // The base-unit price in the item's other units (a box of 12 costs 12 pieces).
    private static List<ResolvedUnitPriceResponse> UnitPrices(Pako.Domain.Companies.Item? item, decimal price)
    {
        var units = new List<ResolvedUnitPriceResponse>();
        if (item is null) return units;
        foreach (var (name, factor) in new[] { (item.SalesUnit, item.SalesUnitFactor), (item.PurchaseUnit, item.PurchaseUnitFactor) })
        {
            if (string.IsNullOrWhiteSpace(name) || factor is not > 0 || units.Any(u => u.UnitName == name)) continue;
            units.Add(new ResolvedUnitPriceResponse(name, factor.Value, Math.Round(price * factor.Value, 4, MidpointRounding.AwayFromZero)));
        }
        return units;
    }

    // ---- Price changes ----

    public async Task<PriceChange> SaveDraftAsync(Guid companyId, PriceChange? change, SavePriceChangeRequest request)
    {
        if (change is { IsPosted: true }) throw new StockException(_localizer["PriceChangePosted"].Value);
        if (request.Lines is null || request.Lines.Count == 0) throw new StockException(_localizer["StockDocumentNoLines"].Value);
        if (request.Lines.Count > 5000) throw new StockException(_localizer["StockDocumentTooManyLines"].Value);
        if (!await _db.PriceLists.AnyAsync(p => p.Id == request.PriceListId && p.CompanyId == companyId && p.IsActive))
        {
            throw new StockException(_localizer["PriceListNotFound"].Value);
        }
        var itemIds = request.Lines.Select(l => l.ItemId).Distinct().ToList();
        if (request.Lines.Select(l => (l.ItemId, l.MinQuantity)).Distinct().Count() != request.Lines.Count)
        {
            throw new StockException(_localizer["StockDocumentDuplicateItem"].Value);
        }
        if (request.Lines.Any(l => l.MinQuantity is < 0 or > 1_000_000_000m)) throw new StockException(_localizer["PriceTierQuantity"].Value);
        if (await _db.Items.CountAsync(i => i.CompanyId == companyId && itemIds.Contains(i.Id)) != itemIds.Count)
        {
            throw new StockException(_localizer["PriceChangeItemNotFound"].Value);
        }
        if (request.Lines.Any(l => l.NewPrice < 0 || l.NewPrice > 1_000_000_000m)) throw new StockException(_localizer["PriceChangePrice"].Value);
        // P7: a medicine's state-set maximum retail price can't be exceeded on any list.
        var capped = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id) && i.MaxRetailPrice != null)
            .ToDictionaryAsync(i => i.Id, i => (i.Name, Cap: i.MaxRetailPrice!.Value));
        if (request.Lines.FirstOrDefault(l => capped.TryGetValue(l.ItemId, out var c) && l.NewPrice > c.Cap) is { } over)
        {
            throw new StockException(string.Format(_localizer["PosAbovePriceCap"].Value, capped[over.ItemId].Name, capped[over.ItemId].Cap));
        }

        if (change is null)
        {
            change = new PriceChange { Id = Guid.NewGuid(), CompanyId = companyId };
            _db.PriceChanges.Add(change);
        }
        change.PriceListId = request.PriceListId;
        change.Date = request.Date;
        change.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        _db.PriceChangeLines.RemoveRange(change.Lines);
        change.Lines = request.Lines.Select(l => new PriceChangeLine
        {
            Id = Guid.NewGuid(), PriceChangeId = change.Id, ItemId = l.ItemId, NewPrice = l.NewPrice, MinQuantity = l.MinQuantity,
        }).ToList();
        _db.PriceChangeLines.AddRange(change.Lines);
        return change;
    }

    // Old price (in force the day before), quantity on hand and the shelf revaluation, as of the
    // document date. Posting stores them; a draft shows them as a preview.
    public async Task<Dictionary<Guid, (decimal? OldPrice, decimal Quantity, decimal Difference)>> RecordAsync(Guid companyId, PriceChange change)
    {
        var list = await _db.PriceLists.AsNoTracking().FirstAsync(p => p.Id == change.PriceListId);
        var itemIds = change.Lines.Select(l => l.ItemId).ToList();
        var old = (await ResolveAsync(companyId, list.WarehouseId, change.Date.AddDays(-1), itemIds,
            list.IsCustomerList ? list.Id : null)).ToDictionary(r => r.ItemId, r => r.Price);
        // A volume tier's old price is the same tier's on this list; tiers are not on the shelf, so
        // they carry no quantity or revaluation.
        var oldTiers = change.Lines.Any(l => l.MinQuantity > 0) ? await TiersOnAsync(list.Id, change.Date.AddDays(-1), itemIds) : new();

        Dictionary<Guid, decimal> quantities;
        if (list.IsCustomerList)
        {
            // A customer list prices no shelf.
            quantities = new();
        }
        else if (list.WarehouseId is { } warehouseId)
        {
            var location = await _stock.StockLocationAsync(companyId, warehouseId);
            quantities = await _stock.QuantitiesAtAsync(location.Id, itemIds, change.Date);
        }
        else
        {
            quantities = await _db.StockMoves.AsNoTracking()
                .Where(m => m.CompanyId == companyId && itemIds.Contains(m.ItemId) && m.Date <= change.Date)
                .GroupBy(m => m.ItemId)
                .Select(g => g.OrderByDescending(m => m.Date).ThenByDescending(m => m.Sequence).First())
                .ToDictionaryAsync(m => m.ItemId, m => m.QtyAfter);
        }

        return change.Lines.ToDictionary(l => l.Id, l =>
        {
            if (l.MinQuantity > 0)
            {
                var tier = oldTiers.TryGetValue(l.ItemId, out var t) ? t.FirstOrDefault(x => x.MinQuantity == l.MinQuantity) : null;
                return (tier?.Price, 0m, 0m);
            }
            var before = old.TryGetValue(l.ItemId, out var p) ? p : (decimal?)null;
            var quantity = quantities.GetValueOrDefault(l.ItemId);
            return (before, quantity, AverageCost.Money(quantity * (l.NewPrice - (before ?? 0m))));
        });
    }

    public async Task PostAsync(Guid companyId, PriceChange change, Guid userId)
    {
        if (change.IsPosted) throw new StockException(_localizer["PriceChangePosted"].Value);
        if (!await _db.PriceLists.AnyAsync(p => p.Id == change.PriceListId && p.CompanyId == companyId && p.IsActive))
        {
            throw new StockException(_localizer["PriceListNotFound"].Value);
        }
        var record = await RecordAsync(companyId, change);
        foreach (var line in change.Lines)
        {
            (line.OldPrice, line.Quantity, line.Difference) = record[line.Id];
            _db.PriceListPrices.Add(new PriceListPrice
            {
                Id = Guid.NewGuid(), PriceListId = change.PriceListId, ItemId = line.ItemId, Price = line.NewPrice, MinQuantity = line.MinQuantity,
                ValidFrom = change.Date, PriceChangeId = change.Id,
            });
        }
        change.Number = await _numbers.ReserveNextAsync(companyId, "PriceChange", change.Date);
        change.State = PriceChangeState.Posted;
        change.PostedAt = DateTime.UtcNow;
        change.PostedByUserId = userId;
    }

    public async Task<PriceChangeResponse> ToResponseAsync(Guid companyId, PriceChange change)
    {
        var list = await _db.PriceLists.AsNoTracking().FirstAsync(p => p.Id == change.PriceListId);
        var itemIds = change.Lines.Select(l => l.ItemId).ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var preview = change.IsPosted ? null : await RecordAsync(companyId, change);
        var lines = change.Lines.OrderBy(l => items.GetValueOrDefault(l.ItemId)?.Code ?? 0).ThenBy(l => l.MinQuantity).Select(l =>
        {
            var item = items.GetValueOrDefault(l.ItemId);
            var (oldPrice, quantity, difference) = preview is null ? (l.OldPrice, l.Quantity ?? 0m, l.Difference ?? 0m) : preview[l.Id];
            return new PriceChangeLineResponse(l.Id, l.ItemId, item?.Code ?? 0, item?.Name ?? "?", item?.Unit ?? string.Empty,
                l.NewPrice, oldPrice, quantity, difference, l.MinQuantity);
        }).ToList();
        return new PriceChangeResponse(change.Id, change.PriceListId, list.Name, change.State, change.Number, change.Date, change.Notes,
            lines.Sum(l => l.Difference ?? 0m), change.PostedAt, lines);
    }
}
