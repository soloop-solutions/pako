using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Reporting;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public class StockMovementsService
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly ITaxComputationService _tax;

    public StockMovementsService(PakoDbContext db, PriceListService prices, ITaxComputationService tax)
    {
        _db = db;
        _prices = prices;
        _tax = tax;
    }

    public async Task<List<StockMovementRow>> RowsAsync(Guid companyId, DateOnly from, DateOnly to, string? search,
        Guid? categoryId, Guid? warehouseId, string? sort)
    {
        var items = _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.TrackInventory && i.Type == ItemType.Goods);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            items = items.Where(i => EF.Functions.ILike(i.Name, pattern) || EF.Functions.ILike(i.Code.ToString(), pattern));
        }
        if (categoryId is { } c) items = items.Where(i => i.CategoryId == c);
        var itemList = await items.ToListAsync();
        var ids = itemList.Select(i => i.Id).ToList();

        var moves = await _db.StockMoves.AsNoTracking()
            .Where(m => m.CompanyId == companyId && m.Date <= to && ids.Contains(m.ItemId))
            .OrderBy(m => m.Date).ThenBy(m => m.Sequence)
            .ToListAsync();

        HashSet<Guid>? warehouseLocations = null;
        if (warehouseId is { } w)
        {
            warehouseLocations = (await _db.StockLocations.AsNoTracking()
                .Where(l => l.CompanyId == companyId && l.WarehouseId == w && (l.Usage == LocationUsage.Internal || l.Usage == LocationUsage.Transit))
                .Select(l => l.Id).ToListAsync()).ToHashSet();
        }

        var categoryIds = itemList.Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToList();
        var categories = await _db.ItemCategories.AsNoTracking().Where(k => categoryIds.Contains(k.Id)).ToDictionaryAsync(k => k.Id, k => k.Name);
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => t.CompanyId == companyId).ToDictionaryAsync(t => t.Id);
        var resolved = (await _prices.ResolveAsync(companyId, warehouseId, to, ids)).ToDictionary(p => p.ItemId, p => p.Price);

        var byItem = moves.GroupBy(m => m.ItemId).ToDictionary(g => g.Key, g => g.ToList());
        var rows = new List<StockMovementRow>();
        foreach (var item in itemList)
        {
            var itemMoves = byItem.GetValueOrDefault(item.Id) ?? new List<StockMove>();
            StockMovementFigures figures;
            decimal averageCost;
            bool hasMovement;
            if (warehouseLocations is null)
            {
                var before = itemMoves.Where(m => m.Date < from).LastOrDefault();
                var period = itemMoves.Where(m => m.Date >= from).ToList();
                figures = StockMovementsCalculator.Calculate(before?.QtyAfter ?? 0m, before?.ValueAfter ?? 0m,
                    period.Select(m => new StockMovementInput(m.Kind, m.Quantity, m.ValueDelta)));
                hasMovement = period.Any(m => m.Kind != StockMoveKind.Transfer);
                averageCost = itemMoves.LastOrDefault()?.AvgCostAfter ?? 0m;
            }
            else
            {
                var beforeInputs = itemMoves.Where(m => m.Date < from).SelectMany(m => WarehouseInputs(m, warehouseLocations)).ToList();
                var periodInputs = itemMoves.Where(m => m.Date >= from).SelectMany(m => WarehouseInputs(m, warehouseLocations)).ToList();
                var opening = StockMovementsCalculator.Calculate(0m, 0m, beforeInputs);
                figures = StockMovementsCalculator.Calculate(opening.ClosingQuantity, opening.ClosingValue, periodInputs);
                hasMovement = periodInputs.Count > 0;
                averageCost = StockMovementsCalculator.UnitCost(figures.ClosingValue, figures.ClosingQuantity);
            }

            if (!hasMovement && figures.OpeningQuantity == 0m && figures.OpeningValue == 0m) continue;

            var tax = item.DefaultTaxDefinitionId is { } t ? taxes.GetValueOrDefault(t) : null;
            var sell = StockMovementsCalculator.NetSellPrice(resolved.TryGetValue(item.Id, out var gross) ? gross : null, tax, _tax);
            rows.Add(new StockMovementRow(item.Id, item.Code, item.Name, item.Unit,
                item.CategoryId is { } k ? categories.GetValueOrDefault(k) : null,
                figures.OpeningQuantity, figures.OpeningValue, figures.InQuantity, figures.InValue,
                figures.OutQuantity, figures.OutValue, figures.ClosingQuantity, averageCost, figures.ClosingValue,
                sell, StockMovementsCalculator.MarkupPercent(sell, averageCost)));
        }

        var descending = sort is not null && sort.StartsWith('-');
        var field = (descending ? sort![1..] : sort)?.ToLowerInvariant();
        IEnumerable<StockMovementRow> ordered = field switch
        {
            "name" => descending ? rows.OrderByDescending(r => r.ItemName) : rows.OrderBy(r => r.ItemName),
            "closingvalue" => descending ? rows.OrderByDescending(r => r.ClosingValue) : rows.OrderBy(r => r.ClosingValue),
            "markup" => descending ? rows.OrderByDescending(r => r.MarkupPercent) : rows.OrderBy(r => r.MarkupPercent),
            _ => descending ? rows.OrderByDescending(r => r.ItemCode) : rows.OrderBy(r => r.ItemCode),
        };
        return ordered.ToList();
    }

    private static IEnumerable<StockMovementInput> WarehouseInputs(StockMove m, HashSet<Guid> locations)
    {
        if (m.Kind == StockMoveKind.Revaluation) yield break;
        if (locations.Contains(m.ToLocationId)) yield return new StockMovementInput(StockMoveKind.Receipt, m.Quantity, m.Value);
        if (locations.Contains(m.FromLocationId)) yield return new StockMovementInput(StockMoveKind.Issue, m.Quantity, -m.Value);
    }

    public static StockMovementsReportResponse Page(DateOnly from, DateOnly to, List<StockMovementRow> rows, int page, int pageSize)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var totals = StockMovementsCalculator.Totals(rows.Select(r => (r.OpeningValue, r.InValue, r.OutValue, r.ClosingValue)));
        return new StockMovementsReportResponse(from, to, rows.Skip((page - 1) * pageSize).Take(pageSize).ToList(), rows.Count, page, pageSize,
            totals.OpeningValue, totals.InValue, totals.OutValue, totals.ClosingValue);
    }
}
