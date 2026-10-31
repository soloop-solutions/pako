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

    // Each item's latest price on one list valid on the date.
    public async Task<Dictionary<Guid, PriceListPrice>> PricesOnAsync(Guid priceListId, DateOnly date, IReadOnlyCollection<Guid>? itemIds = null)
    {
        var query = _db.PriceListPrices.AsNoTracking().Where(p => p.PriceListId == priceListId && p.ValidFrom <= date);
        if (itemIds is not null) query = query.Where(p => itemIds.Contains(p.ItemId));
        var prices = await query.ToListAsync();
        return prices.GroupBy(p => p.ItemId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.ValidFrom).ThenByDescending(p => p.CreatedAt).First());
    }

    public async Task<List<ResolvedPriceResponse>> ResolveAsync(Guid companyId, Guid? warehouseId, DateOnly date, IReadOnlyCollection<Guid> itemIds)
    {
        var lists = await _db.PriceLists.AsNoTracking().Where(p => p.CompanyId == companyId && p.IsActive).ToListAsync();
        var shop = warehouseId is { } w ? lists.FirstOrDefault(p => p.WarehouseId == w) : null;
        var company = lists.FirstOrDefault(p => p.WarehouseId == null);
        var shopPrices = shop is null ? new() : await PricesOnAsync(shop.Id, date, itemIds);
        var companyPrices = company is null ? new() : await PricesOnAsync(company.Id, date, itemIds);
        var defaults = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && itemIds.Contains(i.Id))
            .ToDictionaryAsync(i => i.Id, i => i.DefaultUnitPrice);

        var result = new List<ResolvedPriceResponse>();
        foreach (var id in itemIds.Distinct())
        {
            if (shopPrices.TryGetValue(id, out var s)) result.Add(new(id, s.Price, "warehouse", shop!.Id));
            else if (companyPrices.TryGetValue(id, out var c)) result.Add(new(id, c.Price, "company", company!.Id));
            else if (defaults.GetValueOrDefault(id) is { } d) result.Add(new(id, d, "item", null));
        }
        return result;
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
        if (itemIds.Count != request.Lines.Count) throw new StockException(_localizer["StockDocumentDuplicateItem"].Value);
        if (await _db.Items.CountAsync(i => i.CompanyId == companyId && itemIds.Contains(i.Id)) != itemIds.Count)
        {
            throw new StockException(_localizer["PriceChangeItemNotFound"].Value);
        }
        if (request.Lines.Any(l => l.NewPrice < 0 || l.NewPrice > 1_000_000_000m)) throw new StockException(_localizer["PriceChangePrice"].Value);

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
            Id = Guid.NewGuid(), PriceChangeId = change.Id, ItemId = l.ItemId, NewPrice = l.NewPrice,
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
        var old = (await ResolveAsync(companyId, list.WarehouseId, change.Date.AddDays(-1), itemIds)).ToDictionary(r => r.ItemId, r => r.Price);

        Dictionary<Guid, decimal> quantities;
        if (list.WarehouseId is { } warehouseId)
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
                Id = Guid.NewGuid(), PriceListId = change.PriceListId, ItemId = line.ItemId, Price = line.NewPrice,
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
        var lines = change.Lines.OrderBy(l => items.GetValueOrDefault(l.ItemId)?.Code ?? 0).Select(l =>
        {
            var item = items.GetValueOrDefault(l.ItemId);
            var (oldPrice, quantity, difference) = preview is null ? (l.OldPrice, l.Quantity ?? 0m, l.Difference ?? 0m) : preview[l.Id];
            return new PriceChangeLineResponse(l.Id, l.ItemId, item?.Code ?? 0, item?.Name ?? "?", item?.Unit ?? string.Empty,
                l.NewPrice, oldPrice, quantity, difference);
        }).ToList();
        return new PriceChangeResponse(change.Id, change.PriceListId, list.Name, change.State, change.Number, change.Date, change.Notes,
            lines.Sum(l => l.Difference ?? 0m), change.PostedAt, lines);
    }
}
