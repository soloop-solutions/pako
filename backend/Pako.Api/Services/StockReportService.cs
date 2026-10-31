using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Documents;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/INVENTORY_PLAN.md §5.5 — stock figures shared by the stock reports and the dashboard: gross
// margin on stock-tracked sales, stock value at a date and low stock. Values come from the stock
// ledger's running totals (D10), never recomputed.
public class StockReportService
{
    private readonly PakoDbContext _db;
    private readonly CompanyAccessContext _access;
    private readonly ITaxComputationService _tax;

    public StockReportService(PakoDbContext db, CompanyAccessContext access, ITaxComputationService tax)
    {
        _db = db;
        _access = access;
        _tax = tax;
    }

    // Net sales of stock-tracked lines on posted invoices and sales returns, against the cost of
    // goods sold their stock moves recorded. groupBy: item | customer | month.
    public async Task<MarginReportResponse> MarginAsync(Guid companyId, DateOnly from, DateOnly to, string groupBy)
    {
        var invoices = await _db.Invoices.AsNoTracking().VisibleTo(_access).Include(i => i.Lines)
            .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted && i.IssueDate >= from && i.IssueDate <= to
                && (i.DocumentType == DocumentType.Invoice || i.DocumentType == DocumentType.SalesReturn))
            .ToListAsync();
        var invoiceIds = invoices.Select(i => i.Id).ToList();
        var costs = await _db.StockMoves.AsNoTracking()
            .Where(m => m.SourceType == StockMoveSource.Invoice && invoiceIds.Contains(m.SourceId) && m.SourceLineId != null)
            .Select(m => new { LineId = m.SourceLineId!.Value, m.Value })
            .ToListAsync();
        var costByLine = costs.GroupBy(c => c.LineId).ToDictionary(g => g.Key, g => g.Sum(c => c.Value));
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => t.CompanyId == companyId).ToDictionaryAsync(t => t.Id);
        var itemNames = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId).ToDictionaryAsync(i => i.Id, i => $"{i.Code} {i.Name}");
        var partnerNames = await _db.Partners.AsNoTracking().Where(p => p.CompanyId == companyId).ToDictionaryAsync(p => p.Id, p => p.Name);

        var lines = invoices.SelectMany(inv => inv.Lines.Where(l => costByLine.ContainsKey(l.Id)).Select(l =>
        {
            var sign = inv.DocumentType == DocumentType.SalesReturn ? -1 : 1;
            var net = DocumentLineCalculator.Calculate(l.Quantity, l.UnitPrice, l.DiscountPercent, l.RevenueAccountId, l.Description,
                l.TaxDefinitionId is { } t ? taxes.GetValueOrDefault(t) : null, false, true, _tax, Guid.Empty, Guid.Empty, inv.PriceMode).NetAmount;
            var key = groupBy switch
            {
                "customer" => inv.PartnerId.ToString(),
                "month" => $"{inv.IssueDate:yyyy-MM}",
                _ => l.ItemId!.Value.ToString(),
            };
            var label = groupBy switch
            {
                "customer" => partnerNames.GetValueOrDefault(inv.PartnerId) ?? "?",
                "month" => $"{inv.IssueDate:yyyy-MM}",
                _ => itemNames.GetValueOrDefault(l.ItemId!.Value) ?? "?",
            };
            return (Key: key, Label: label, Quantity: sign * l.Quantity, Net: sign * net, Cost: sign * costByLine[l.Id]);
        })).ToList();

        var rows = lines.GroupBy(l => l.Key).Select(g =>
        {
            var net = g.Sum(x => x.Net);
            var cost = g.Sum(x => x.Cost);
            return new MarginRowResponse(g.Key, g.First().Label, g.Sum(x => x.Quantity), net, cost, net - cost, Percent(net, net - cost));
        }).OrderBy(r => groupBy == "month" ? r.Key : null).ThenByDescending(r => r.Margin).ToList();
        var totalNet = rows.Sum(r => r.NetSales);
        var totalCost = rows.Sum(r => r.Cost);
        return new MarginReportResponse(from, to, groupBy is "customer" or "month" ? groupBy : "item", totalNet, totalCost,
            totalNet - totalCost, Percent(totalNet, totalNet - totalCost), rows);
    }

    public static decimal? Percent(decimal net, decimal margin) =>
        net == 0 ? null : Math.Round(margin / net * 100m, 1, MidpointRounding.AwayFromZero);

    // Each item's quantity and value at the close of each date: the last move on or before it carries
    // the item's running totals. One read of the ledger serves every date.
    public async Task<Dictionary<DateOnly, Dictionary<Guid, (decimal Quantity, decimal Value)>>> PositionsAtAsync(
        Guid companyId, IReadOnlyCollection<DateOnly> dates)
    {
        var result = dates.Distinct().ToDictionary(d => d, _ => new Dictionary<Guid, (decimal, decimal)>());
        if (result.Count == 0) return result;
        var last = result.Keys.Max();
        var moves = await _db.StockMoves.AsNoTracking()
            .Where(m => m.CompanyId == companyId && m.Date <= last)
            .OrderBy(m => m.Date).ThenBy(m => m.Sequence)
            .Select(m => new { m.ItemId, m.Date, m.QtyAfter, m.ValueAfter })
            .ToListAsync();
        var running = new Dictionary<Guid, (decimal, decimal)>();
        var index = 0;
        foreach (var date in result.Keys.OrderBy(d => d).ToList())
        {
            for (; index < moves.Count && moves[index].Date <= date; index++)
            {
                running[moves[index].ItemId] = (moves[index].QtyAfter, moves[index].ValueAfter);
            }
            result[date] = new Dictionary<Guid, (decimal, decimal)>(running);
        }
        return result;
    }

    // Stock-tracked items with a minimum whose quantity at the date is below it.
    public async Task<int> BelowMinimumCountAsync(Guid companyId, IReadOnlyDictionary<Guid, (decimal Quantity, decimal Value)> positions)
    {
        var minimums = await _db.Items.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.TrackInventory && i.MinimumStock != null)
            .Select(i => new { i.Id, Minimum = i.MinimumStock!.Value })
            .ToListAsync();
        return minimums.Count(i => (positions.TryGetValue(i.Id, out var p) ? p.Quantity : 0m) < i.Minimum);
    }

    public async Task<Dictionary<Guid, string>> ItemNamesAsync(Guid companyId) =>
        await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.TrackInventory)
            .ToDictionaryAsync(i => i.Id, i => i.Name);
}
