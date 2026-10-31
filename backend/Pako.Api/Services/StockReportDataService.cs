using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Companies;
using Pako.Domain.Inventory;
using Pako.Domain.Ledger;
using Pako.Domain.Reporting;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public record StockLevelsRow(
    Guid ItemId, int ItemCode, string ItemName, string Unit, string? CategoryName, decimal Quantity, decimal AverageCost, decimal Value,
    decimal? MinimumStock, decimal? SellPriceExVat, decimal? MarkupPercent);

public class StockReportDataService
{
    private readonly PakoDbContext _db;
    private readonly StockService _stock;
    private readonly PriceListService _prices;
    private readonly ITaxComputationService _tax;

    public StockReportDataService(PakoDbContext db, StockService stock, PriceListService prices, ITaxComputationService tax)
    {
        _db = db;
        _stock = stock;
        _prices = prices;
        _tax = tax;
    }

    public async Task<List<StockLevelsRow>> LevelsAsync(Guid companyId, string? search, Guid? warehouseId, Guid? categoryId, bool belowMinimum, DateOnly priceDate)
    {
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

        var list = await items.OrderBy(i => i.Code).ToListAsync();
        var ids = list.Select(i => i.Id).ToList();
        var costs = await _db.ItemCosts.AsNoTracking().Where(k => k.CompanyId == companyId && ids.Contains(k.ItemId)).ToDictionaryAsync(k => k.ItemId);
        var warehouseLocations = warehouseId is { } w
            ? await _db.StockLocations.AsNoTracking().Where(l => l.CompanyId == companyId && l.WarehouseId == w && l.Usage == LocationUsage.Internal).Select(l => l.Id).ToListAsync()
            : new List<Guid>();
        var balances = warehouseId is null
            ? new Dictionary<Guid, decimal>()
            : (await _db.StockBalances.AsNoTracking().Where(b => b.CompanyId == companyId && warehouseLocations.Contains(b.LocationId) && ids.Contains(b.ItemId)).ToListAsync())
                .GroupBy(b => b.ItemId).ToDictionary(g => g.Key, g => g.Sum(b => b.Quantity));
        var categoryIds = list.Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToList();
        var categories = await _db.ItemCategories.AsNoTracking().Where(k => categoryIds.Contains(k.Id)).ToDictionaryAsync(k => k.Id, k => k.Name);
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => t.CompanyId == companyId).ToDictionaryAsync(t => t.Id);
        var resolved = (await _prices.ResolveAsync(companyId, warehouseId, priceDate, ids)).ToDictionary(p => p.ItemId, p => p.Price);

        return list.Select(i =>
        {
            var cost = costs.GetValueOrDefault(i.Id);
            var average = cost?.AverageCost ?? 0m;
            var quantity = warehouseId is null ? cost?.Quantity ?? 0m : balances.GetValueOrDefault(i.Id);
            var value = warehouseId is null ? cost?.Value ?? 0m : AverageCost.Money(quantity * average);
            var tax = i.DefaultTaxDefinitionId is { } t ? taxes.GetValueOrDefault(t) : null;
            var sell = StockMovementsCalculator.NetSellPrice(resolved.TryGetValue(i.Id, out var gross) ? gross : null, tax, _tax);
            return new StockLevelsRow(i.Id, i.Code, i.Name, i.Unit, i.CategoryId is { } k ? categories.GetValueOrDefault(k) : null,
                quantity, average, value, i.MinimumStock, sell, StockMovementsCalculator.MarkupPercent(sell, average));
        }).ToList();
    }

    public async Task<ItemCardResponse?> CardAsync(Guid companyId, Guid itemId, DateOnly? from, DateOnly? to)
    {
        var item = await _db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == itemId && i.CompanyId == companyId);
        if (item is null) return null;
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
        return new ItemCardResponse(item.Id, item.Code, item.Name, item.Unit, from, to,
            opening?.QtyAfter ?? 0m, opening?.ValueAfter ?? 0m, last?.QtyAfter ?? opening?.QtyAfter ?? 0m, last?.ValueAfter ?? opening?.ValueAfter ?? 0m, rows);
    }

    public async Task<StockValuationResponse> ValuationAsync(Guid companyId, DateOnly asOf)
    {
        var lastMoves = await _db.StockMoves.AsNoTracking()
            .Where(m => m.CompanyId == companyId && m.Date <= asOf)
            .GroupBy(m => m.ItemId)
            .Select(g => g.OrderByDescending(m => m.Date).ThenByDescending(m => m.Sequence).First())
            .ToListAsync();
        var itemIds = lastMoves.Select(m => m.ItemId).ToList();
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        var accounts = await _stock.AccountsForAsync(companyId, items.Values);
        var rows = lastMoves.Where(m => m.QtyAfter != 0 || m.ValueAfter != 0).Select(m => new StockValuationRowResponse(m.ItemId,
            items[m.ItemId].Code, items[m.ItemId].Name, items[m.ItemId].Unit, m.QtyAfter, m.AvgCostAfter, m.ValueAfter))
            .OrderBy(r => r.ItemCode).ToList();

        var stockByAccount = lastMoves.GroupBy(m => accounts[m.ItemId].InventoryAccountId).ToDictionary(g => g.Key, g => g.Sum(m => m.ValueAfter));
        var accountIds = stockByAccount.Keys.ToList();
        var ledger = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => accountIds.Contains(l.AccountId) && l.JournalEntry!.CompanyId == companyId
                && l.JournalEntry.State != JournalEntryState.Draft && l.JournalEntry.Date <= asOf)
            .GroupBy(l => l.AccountId).Select(g => new { g.Key, Balance = g.Sum(l => l.Debit - l.Credit) })
            .ToDictionaryAsync(g => g.Key, g => g.Balance);
        var accountRows = await _db.Accounts.AsNoTracking().Where(a => accountIds.Contains(a.Id)).OrderBy(a => a.Code)
            .Select(a => new { a.Id, a.Code, a.Name }).ToListAsync();
        var accountResponses = accountRows.Select(a => new StockValuationAccountResponse(a.Id, a.Code, a.Name,
            stockByAccount.GetValueOrDefault(a.Id), ledger.GetValueOrDefault(a.Id))).ToList();
        var stockValue = rows.Sum(r => r.Value);
        var ledgerValue = accountResponses.Sum(a => a.LedgerValue);
        var allowanceId = await _stock.AccountIdByCodeAsync(companyId, StockService.WriteDownAllowanceCode);
        var allowance = allowanceId is { } aid
            ? await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.AccountId == aid && l.JournalEntry!.CompanyId == companyId
                    && l.JournalEntry.State != JournalEntryState.Draft && l.JournalEntry.Date <= asOf)
                .SumAsync(l => l.Credit - l.Debit)
            : 0m;
        return new StockValuationResponse(asOf, stockValue, ledgerValue, ledgerValue - stockValue, rows, accountResponses,
            allowance, stockValue - allowance);
    }

    public Task<bool> HasTrackedItemsAsync(Guid companyId) =>
        _db.Items.AsNoTracking().AnyAsync(i => i.CompanyId == companyId && i.TrackInventory);
}
