using Microsoft.EntityFrameworkCore;
using Pako.Api.Contracts;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// docs/POS_PLAN.md P2: store-scoped sales reporting. Every figure is the till's own: lines and
// payments as recorded, returns and cancellations taken off, cost as snapshotted when sold.
public class PosReportService
{
    private readonly PakoDbContext _db;

    public PosReportService(PakoDbContext db) => _db = db;

    private record Fact(PosOrder Order, PosOrderLine Line, decimal Sign);

    public async Task<PosSalesReportResponse> SalesAsync(Guid companyId, DateOnly from, DateOnly to, PosReportGroup group, Guid? storeId, Guid? registerId)
    {
        // A day in Kosovo starts up to two hours before UTC midnight: take a margin, then filter on
        // the local date.
        var start = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(-1);
        var end = to.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(2);
        var query = _db.PosOrders.AsNoTracking().Include(o => o.Lines).Include(o => o.Payments)
            .Where(o => o.CompanyId == companyId && o.OrderedAt >= start && o.OrderedAt < end);
        if (storeId is { } s) query = query.Where(o => o.StoreId == s);
        if (registerId is { } r) query = query.Where(o => o.RegisterId == r);
        var orders = (await query.ToListAsync())
            .Where(o => DateOnly.FromDateTime(PosService.LocalTime(o.OrderedAt)) is var day && day >= from && day <= to).ToList();

        List<PosSalesReportRow> rows;
        if (group == PosReportGroup.Tender)
        {
            var methods = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == companyId).ToDictionaryAsync(m => m.Id, m => m.Name);
            rows = orders.SelectMany(o => o.Payments.Select(p => (o, p)))
                .GroupBy(x => x.p.PaymentMethodId)
                .Select(g =>
                {
                    var sales = g.Where(x => x.o.Kind == PosOrderKind.Sale).Sum(x => x.p.Amount);
                    var refunds = g.Where(x => x.o.Kind != PosOrderKind.Sale).Sum(x => x.p.Amount);
                    return new PosSalesReportRow(g.Key.ToString(), methods.GetValueOrDefault(g.Key) ?? "?",
                        g.Where(x => x.o.Kind == PosOrderKind.Sale).Select(x => x.o.Id).Distinct().Count(), 0m, sales, refunds, sales - refunds, 0m, 0m, null, null);
                })
                .OrderByDescending(r => r.NetSales).ToList();
        }
        else
        {
            // Gift cards sold are a liability, not sales.
            var facts = orders.SelectMany(o => o.Lines.Where(l => l.GiftCardNumber == null)
                .Select(l => new Fact(o, l, o.Kind == PosOrderKind.Sale ? 1m : -1m))).ToList();
            var (keyOf, labels) = await KeysAsync(companyId, group, facts);
            var costed = group is PosReportGroup.Item or PosReportGroup.Category;
            rows = facts.GroupBy(keyOf)
                .Select(g =>
                {
                    var sales = g.Where(f => f.Sign > 0).Sum(f => f.Line.Gross);
                    var returns = g.Where(f => f.Sign < 0).Sum(f => f.Line.Gross);
                    var cost = g.Sum(f => f.Sign * f.Line.CostValue + f.Line.CostCorrection + f.Line.CostReplay);
                    var net = g.Sum(f => f.Sign * f.Line.Net);
                    return new PosSalesReportRow(g.Key, labels.GetValueOrDefault(g.Key) ?? g.Key,
                        g.Where(f => f.Sign > 0).Select(f => f.Order.Id).Distinct().Count(), g.Sum(f => f.Sign * f.Line.Quantity),
                        sales, returns, sales - returns, g.Sum(f => f.Sign * f.Line.Tax), g.Sum(f => f.Sign * f.Line.DiscountAmount),
                        costed ? cost : null, costed ? net - cost : null);
                })
                .OrderBy(r => group is PosReportGroup.Day or PosReportGroup.Hour ? r.Key : null)
                .ThenByDescending(r => group is PosReportGroup.Day or PosReportGroup.Hour ? 0m : r.NetSales).ToList();
        }

        var total = new PosSalesReportRow("", "", rows.Sum(r => r.Orders), rows.Sum(r => r.Quantity), rows.Sum(r => r.Sales), rows.Sum(r => r.Returns),
            rows.Sum(r => r.NetSales), rows.Sum(r => r.Tax), rows.Sum(r => r.Discount),
            rows.Any(r => r.Cost != null) ? rows.Sum(r => r.Cost ?? 0m) : null, rows.Any(r => r.Margin != null) ? rows.Sum(r => r.Margin ?? 0m) : null);
        // Orders aren't additive across lines of different groups; the total counts sales once.
        total = total with { Orders = orders.Count(o => o.Kind == PosOrderKind.Sale) };
        return new PosSalesReportResponse(from, to, group, rows, total);
    }

    // How lines are grouped and what each group is called.
    private async Task<(Func<Fact, string> Key, Dictionary<string, string> Labels)> KeysAsync(Guid companyId, PosReportGroup group, List<Fact> facts)
    {
        switch (group)
        {
            case PosReportGroup.Day:
                return (f => DateOnly.FromDateTime(PosService.LocalTime(f.Order.OrderedAt)).ToString("yyyy-MM-dd"), new());
            case PosReportGroup.Hour:
                return (f => PosService.LocalTime(f.Order.OrderedAt).ToString("HH") + ":00", new());
            case PosReportGroup.Cashier:
                return (f => f.Order.OperatorName, new());
            case PosReportGroup.Store:
                return (f => f.Order.StoreId.ToString(),
                    await _db.PosStores.AsNoTracking().Where(s => s.CompanyId == companyId).ToDictionaryAsync(s => s.Id.ToString(), s => s.Name));
            case PosReportGroup.Register:
                return (f => f.Order.RegisterId.ToString(),
                    await _db.PosRegisters.AsNoTracking().Where(r => r.CompanyId == companyId).ToDictionaryAsync(r => r.Id.ToString(), r => $"{r.Code} · {r.Name}"));
            case PosReportGroup.Item:
                {
                    var ids = facts.Where(f => f.Line.ItemId != null).Select(f => f.Line.ItemId!.Value).Distinct().ToList();
                    var names = await _db.Items.AsNoTracking().Where(i => ids.Contains(i.Id)).ToDictionaryAsync(i => i.Id.ToString(), i => $"{i.Code} · {i.Name}");
                    return (f => f.Line.ItemId?.ToString() ?? f.Line.Description, names);
                }
            case PosReportGroup.Category:
                {
                    var ids = facts.Where(f => f.Line.ItemId != null).Select(f => f.Line.ItemId!.Value).Distinct().ToList();
                    var categoryOf = await _db.Items.AsNoTracking().Where(i => ids.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.CategoryId);
                    var names = await _db.ItemCategories.AsNoTracking().Where(c => c.CompanyId == companyId).ToDictionaryAsync(c => c.Id.ToString(), c => c.Name);
                    return (f => f.Line.ItemId is { } id && categoryOf.GetValueOrDefault(id) is { } cat ? cat.ToString() : "", names);
                }
            case PosReportGroup.Program:
                return (f => f.Line.ProgramId?.ToString() ?? "",
                    await _db.PosPrograms.AsNoTracking().Where(p => p.CompanyId == companyId).ToDictionaryAsync(p => p.Id.ToString(), p => p.Name));
            default:
                return (_ => "", new());
        }
    }
}
