using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Documents;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payroll;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using BillDocumentType = Pako.Domain.Bills.DocumentType;
using InvoiceDocumentType = Pako.Domain.Invoicing.DocumentType;

namespace Pako.Api.Services;

// Every figure on the dashboard, for a period and an optional comparison period. Ledger figures
// (revenue, expenses, profit, cash, receivables, payables) come from posted journal lines, the same
// source as the P&L and balance sheet, so the dashboard always agrees with the reports. Rankings by
// customer, vendor and item are net of VAT, computed per document line by DocumentLineCalculator,
// the same function that posted them. Each section is filled only when the caller may see that area.
public class DashboardService
{
    public const int RankLimit = 6;
    public const string OtherName = "__other";
    public const string NoneName = "__none";

    public static readonly string[] Granularities = ["day", "week", "month", "quarter"];

    private readonly PakoDbContext _db;
    private readonly CompanyAccessContext _access;
    private readonly ITaxComputationService _tax;

    public DashboardService(PakoDbContext db, CompanyAccessContext access, ITaxComputationService tax)
    {
        _db = db;
        _access = access;
        _tax = tax;
    }

    private record Period(DateOnly From, DateOnly To, List<(DateOnly Start, DateOnly End)> Buckets);

    public async Task<DashboardResponse> BuildAsync(
        Guid companyId, DateOnly from, DateOnly to, DateOnly? compareFrom, DateOnly? compareTo, string? granularity)
    {
        var sections = new DashboardSections(
            Finance: _access.LevelFor(AccessModule.Reports) >= AccessLevel.Read && !_access.IsPartnerRestricted,
            Sales: _access.LevelFor(AccessModule.Sales) >= AccessLevel.Read,
            Purchases: _access.LevelFor(AccessModule.Purchases) >= AccessLevel.Read,
            Payroll: _access.LevelFor(AccessModule.Payroll) >= AccessLevel.Read,
            Hr: _access.LevelFor(AccessModule.Hr) >= AccessLevel.Read);

        var resolvedGranularity = ResolveGranularity(from, to, granularity);
        var current = new Period(from, to, Buckets(from, to, resolvedGranularity));
        Period? compare = compareFrom is { } cf && compareTo is { } ct && cf <= ct
            ? new Period(cf, ct, Buckets(cf, ct, resolvedGranularity))
            : null;

        var kpis = new List<DashboardKpi>();
        var series = current.Buckets.Select(b => new DashboardPoint(b.Start, b.End, 0, 0, 0, 0, 0)).ToList();
        var compareSeries = compare?.Buckets.Select(b => new DashboardPoint(b.Start, b.End, 0, 0, 0, 0, 0)).ToList();
        var revenueByAccount = new List<DashboardRankItem>();
        var expensesByAccount = new List<DashboardRankItem>();
        var topCustomers = new List<DashboardRankItem>();
        var topVendors = new List<DashboardRankItem>();
        var topItems = new List<DashboardRankItem>();
        var receivablesAging = new List<DashboardAgingBucket>();
        var payablesAging = new List<DashboardAgingBucket>();
        var headcountByDepartment = new List<DashboardRankItem>();

        if (sections.Finance)
        {
            var accounts = await _db.Accounts.AsNoTracking().Where(a => a.CompanyId == companyId)
                .Select(a => new { a.Id, a.Code, a.Name, a.AccountType })
                .ToDictionaryAsync(a => a.Id);
            var start = compare is null || from <= compare.From ? from : compare.From;
            var end = compare is null || to >= compare.To ? to : compare.To;
            var daily = await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntry!.CompanyId == companyId && l.JournalEntry.State == JournalEntryState.Posted
                    && l.JournalEntry.Date >= start && l.JournalEntry.Date <= end)
                .GroupBy(l => new { l.AccountId, l.JournalEntry!.Date })
                .Select(g => new { g.Key.AccountId, g.Key.Date, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) })
                .ToListAsync();
            var rows = daily.Where(d => accounts.ContainsKey(d.AccountId))
                .Select(d => (Type: accounts[d.AccountId].AccountType, d.AccountId, d.Date, d.Debit, d.Credit))
                .ToList();

            var cashIds = accounts.Values.Where(a => a.AccountType == AccountType.Cash).Select(a => a.Id).ToList();
            var receivableIds = accounts.Values.Where(a => a.AccountType == AccountType.Receivable).Select(a => a.Id).ToList();
            var payableIds = accounts.Values.Where(a => a.AccountType == AccountType.Payable).Select(a => a.Id).ToList();

            async Task<List<DashboardPoint>> SeriesFor(Period period)
            {
                var cash = await DebitBalanceAsync(companyId, cashIds, period.From.AddDays(-1));
                var points = new List<DashboardPoint>();
                foreach (var (bStart, bEnd) in period.Buckets)
                {
                    var inBucket = rows.Where(r => r.Date >= bStart && r.Date <= bEnd).ToList();
                    var revenue = inBucket.Where(r => AccountTypeDerivation.IsIncome(r.Type)).Sum(r => r.Credit - r.Debit);
                    var expenses = inBucket.Where(r => AccountTypeDerivation.IsExpense(r.Type)).Sum(r => r.Debit - r.Credit);
                    cash += inBucket.Where(r => r.Type == AccountType.Cash).Sum(r => r.Debit - r.Credit);
                    points.Add(new DashboardPoint(bStart, bEnd, revenue, expenses, revenue - expenses, cash, 0));
                }
                return points;
            }

            series = await SeriesFor(current);
            if (compare is not null)
            {
                compareSeries = await SeriesFor(compare);
            }

            decimal Sum(Period p, Func<AccountType, bool> type, bool creditNormal) => rows
                .Where(r => r.Date >= p.From && r.Date <= p.To && type(r.Type))
                .Sum(r => creditNormal ? r.Credit - r.Debit : r.Debit - r.Credit);

            var revenue = Sum(current, AccountTypeDerivation.IsIncome, true);
            var expenses = Sum(current, AccountTypeDerivation.IsExpense, false);
            var grossProfit = Sum(current, t => t == AccountType.Income, true) - Sum(current, t => t == AccountType.CostOfRevenue, false);
            decimal? prevRevenue = compare is null ? null : Sum(compare, AccountTypeDerivation.IsIncome, true);
            decimal? prevExpenses = compare is null ? null : Sum(compare, AccountTypeDerivation.IsExpense, false);
            decimal? prevGross = compare is null
                ? null
                : Sum(compare, t => t == AccountType.Income, true) - Sum(compare, t => t == AccountType.CostOfRevenue, false);

            kpis.Add(Kpi("revenue", revenue, prevRevenue, series.Select(p => p.Revenue)));
            kpis.Add(Kpi("expenses", expenses, prevExpenses, series.Select(p => p.Expenses)));
            kpis.Add(Kpi("netProfit", revenue - expenses, prevRevenue - prevExpenses, series.Select(p => p.NetProfit)));
            kpis.Add(Kpi("grossProfit", grossProfit, prevGross, Array.Empty<decimal>()));
            kpis.Add(Kpi("netMargin", Margin(revenue, revenue - expenses),
                compare is null ? null : Margin(prevRevenue!.Value, prevRevenue.Value - prevExpenses!.Value),
                series.Select(p => Margin(p.Revenue, p.NetProfit))));
            kpis.Add(Kpi("cash", series.Count > 0 ? series[^1].CashBalance : 0,
                compareSeries is { Count: > 0 } ? compareSeries[^1].CashBalance : null, series.Select(p => p.CashBalance)));
            kpis.Add(Kpi("receivables", await DebitBalanceAsync(companyId, receivableIds, to),
                compare is null ? null : await DebitBalanceAsync(companyId, receivableIds, compare.To), Array.Empty<decimal>()));
            kpis.Add(Kpi("payables", -await DebitBalanceAsync(companyId, payableIds, to),
                compare is null ? null : -await DebitBalanceAsync(companyId, payableIds, compare.To), Array.Empty<decimal>()));

            List<DashboardRankItem> ByAccount(Func<AccountType, bool> type, bool creditNormal)
            {
                decimal Amount(Period p, Guid id) => rows.Where(r => r.AccountId == id && r.Date >= p.From && r.Date <= p.To)
                    .Sum(r => creditNormal ? r.Credit - r.Debit : r.Debit - r.Credit);
                var ids = rows.Where(r => type(r.Type)).Select(r => r.AccountId).Distinct();
                return Rank(ids.Select(id => new DashboardRankItem(id, $"{accounts[id].Code} {accounts[id].Name}",
                    Amount(current, id), compare is null ? null : Amount(compare, id))), compare is not null);
            }

            revenueByAccount = ByAccount(AccountTypeDerivation.IsIncome, true);
            expensesByAccount = ByAccount(AccountTypeDerivation.IsExpense, false);
        }

        if (sections.Sales)
        {
            var sales = await InvoiceLinesAsync(companyId, current, compare);
            topCustomers = await NameAsync(RankBy(sales, l => l.PartnerId, current, compare), _db.Partners.AsNoTracking()
                .Where(p => p.CompanyId == companyId).Select(p => new { p.Id, p.Name }).ToDictionaryAsync(p => p.Id, p => p.Name));
            topItems = await NameAsync(RankBy(sales.Where(l => l.ItemId != null).ToList(), l => l.ItemId!.Value, current, compare),
                _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId).Select(i => new { i.Id, i.Name }).ToDictionaryAsync(i => i.Id, i => i.Name));

            var count = sales.Where(l => InPeriod(l.Date, current) && l.IsInvoice).Select(l => l.DocumentId).Distinct().Count();
            var net = sales.Where(l => InPeriod(l.Date, current)).Sum(l => l.Net);
            int? prevCount = compare is null ? null : sales.Where(l => InPeriod(l.Date, compare) && l.IsInvoice).Select(l => l.DocumentId).Distinct().Count();
            decimal? prevNet = compare is null ? null : sales.Where(l => InPeriod(l.Date, compare)).Sum(l => l.Net);
            kpis.Add(Kpi("invoiceCount", count, prevCount, current.Buckets.Select(b =>
                (decimal)sales.Where(l => l.IsInvoice && l.Date >= b.Start && l.Date <= b.End).Select(l => l.DocumentId).Distinct().Count())));
            kpis.Add(Kpi("salesNet", net, prevNet, current.Buckets.Select(b => sales.Where(l => l.Date >= b.Start && l.Date <= b.End).Sum(l => l.Net))));
            kpis.Add(Kpi("averageInvoice", count == 0 ? 0 : Math.Round(net / count, 2, MidpointRounding.AwayFromZero),
                prevCount is null ? null : prevCount == 0 ? 0 : Math.Round(prevNet!.Value / prevCount.Value, 2, MidpointRounding.AwayFromZero),
                Array.Empty<decimal>()));
        }

        if (sections.Purchases)
        {
            var purchases = await BillLinesAsync(companyId, current, compare);
            topVendors = await NameAsync(RankBy(purchases, l => l.PartnerId, current, compare), _db.Partners.AsNoTracking()
                .Where(p => p.CompanyId == companyId).Select(p => new { p.Id, p.Name }).ToDictionaryAsync(p => p.Id, p => p.Name));
            kpis.Add(Kpi("purchasesNet", purchases.Where(l => InPeriod(l.Date, current)).Sum(l => l.Net),
                compare is null ? null : purchases.Where(l => InPeriod(l.Date, compare)).Sum(l => l.Net),
                current.Buckets.Select(b => purchases.Where(l => l.Date >= b.Start && l.Date <= b.End).Sum(l => l.Net))));
        }

        // Aging is measured at the period end, or today when the period runs into the future, so
        // nothing counts as overdue before its due date has actually passed.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var agingAsOf = to > today ? today : to;
        if (sections.Finance || sections.Sales)
        {
            receivablesAging = await ReceivablesAgingAsync(companyId, agingAsOf);
            kpis.Add(Kpi("overdueReceivables", receivablesAging.Where(b => b.Key != "notDue").Sum(b => b.Amount), null, Array.Empty<decimal>()));
        }

        if (sections.Finance || sections.Purchases)
        {
            payablesAging = await PayablesAgingAsync(companyId, agingAsOf);
            kpis.Add(Kpi("overduePayables", payablesAging.Where(b => b.Key != "notDue").Sum(b => b.Amount), null, Array.Empty<decimal>()));
        }

        if (sections.Payroll)
        {
            var runsFrom = compare is null || from <= compare.From ? from : compare.From;
            var runsTo = compare is null || to >= compare.To ? to : compare.To;
            var runs = await _db.PayrollRuns.AsNoTracking()
                .Where(r => r.CompanyId == companyId && (r.State == PayrollRunState.Posted || r.State == PayrollRunState.Paid)
                    && r.PeriodEnd >= runsFrom && r.PeriodEnd <= runsTo)
                .Select(r => new { r.PeriodEnd, Cost = r.Lines.Sum(l => l.GrossSalary + l.EmployerPensionAmount) })
                .ToListAsync();
            decimal CostIn(DateOnly s, DateOnly e) => runs.Where(r => r.PeriodEnd >= s && r.PeriodEnd <= e).Sum(r => r.Cost);
            series = series.Select(p => p with { PayrollCost = CostIn(p.Start, p.End) }).ToList();
            compareSeries = compareSeries?.Select(p => p with { PayrollCost = CostIn(p.Start, p.End) }).ToList();
            kpis.Add(Kpi("payrollCost", CostIn(from, to), compare is null ? null : CostIn(compare.From, compare.To),
                series.Select(p => p.PayrollCost)));
        }

        if (sections.Hr)
        {
            var employees = await _db.Employees.AsNoTracking().Where(e => e.CompanyId == companyId)
                .Select(e => new { e.DepartmentId, e.HireDate, e.TerminationDate, e.IsActive })
                .ToListAsync();
            bool ActiveOn(DateOnly day, DateOnly? hire, DateOnly? left, bool isActive) =>
                (hire is null || hire <= day) && (left is null ? isActive : left >= day);
            int Headcount(DateOnly day) => employees.Count(e => ActiveOn(day, e.HireDate, e.TerminationDate, e.IsActive));
            kpis.Add(Kpi("headcount", Headcount(to), compare is null ? null : Headcount(compare.To),
                current.Buckets.Select(b => (decimal)Headcount(b.End))));

            var departments = await _db.Departments.AsNoTracking().Where(d => d.CompanyId == companyId)
                .ToDictionaryAsync(d => d.Id, d => d.Name);
            headcountByDepartment = employees
                .GroupBy(e => e.DepartmentId)
                .Select(g => new DashboardRankItem(g.Key,
                    g.Key is { } id && departments.TryGetValue(id, out var name) ? name : NoneName,
                    g.Count(e => ActiveOn(to, e.HireDate, e.TerminationDate, e.IsActive)),
                    compare is null ? null : g.Count(e => ActiveOn(compare.To, e.HireDate, e.TerminationDate, e.IsActive))))
                .Where(r => r.Current > 0 || (r.Previous ?? 0) > 0)
                .OrderByDescending(r => r.Current)
                .ToList();
        }

        return new DashboardResponse(
            from, to, compare?.From, compare?.To, resolvedGranularity, sections, kpis, series, compareSeries,
            revenueByAccount, expensesByAccount, topCustomers, topVendors, topItems, receivablesAging, payablesAging,
            headcountByDepartment);
    }

    // ---- Periods ----

    public static string ResolveGranularity(DateOnly from, DateOnly to, string? requested)
    {
        var days = to.DayNumber - from.DayNumber + 1;
        if (requested is not null && Granularities.Contains(requested))
        {
            // Never more than ~120 points: a request for days over a year falls back to automatic.
            var points = requested switch { "day" => days, "week" => days / 7, "month" => days / 28, _ => days / 90 };
            if (points <= 120)
            {
                return requested;
            }
        }

        return days <= 31 ? "day" : days <= 120 ? "week" : days <= 731 ? "month" : "quarter";
    }

    public static List<(DateOnly Start, DateOnly End)> Buckets(DateOnly from, DateOnly to, string granularity)
    {
        var buckets = new List<(DateOnly, DateOnly)>();
        var start = from;
        while (start <= to)
        {
            var end = granularity switch
            {
                "day" => start,
                "week" => start.AddDays(6),
                "month" => new DateOnly(start.Year, start.Month, DateTime.DaysInMonth(start.Year, start.Month)),
                _ => QuarterEnd(start),
            };
            if (end > to)
            {
                end = to;
            }
            buckets.Add((start, end));
            start = end.AddDays(1);
        }
        return buckets;
    }

    private static DateOnly QuarterEnd(DateOnly day)
    {
        var lastMonth = ((day.Month - 1) / 3 + 1) * 3;
        return new DateOnly(day.Year, lastMonth, DateTime.DaysInMonth(day.Year, lastMonth));
    }

    private static bool InPeriod(DateOnly date, Period period) => date >= period.From && date <= period.To;

    // ---- Figures ----

    private static DashboardKpi Kpi(string key, decimal current, decimal? previous, IEnumerable<decimal> trend) =>
        new(key, current, previous, ChangePercent(current, previous), trend.ToList());

    public static decimal? ChangePercent(decimal current, decimal? previous) =>
        previous is { } p && p != 0 ? Math.Round((current - p) / Math.Abs(p) * 100m, 1, MidpointRounding.AwayFromZero) : null;

    private static decimal Margin(decimal revenue, decimal profit) =>
        revenue == 0 ? 0 : Math.Round(profit / revenue * 100m, 1, MidpointRounding.AwayFromZero);

    private async Task<decimal> DebitBalanceAsync(Guid companyId, List<Guid> accountIds, DateOnly asOf) =>
        accountIds.Count == 0
            ? 0
            : await _db.JournalEntryLines.AsNoTracking()
                .Where(l => accountIds.Contains(l.AccountId) && l.JournalEntry!.CompanyId == companyId
                    && l.JournalEntry.State == JournalEntryState.Posted && l.JournalEntry.Date <= asOf)
                .SumAsync(l => l.Debit - l.Credit);

    // Top RankLimit rows by the current amount; the rest fold into one "other" row.
    private static List<DashboardRankItem> Rank(IEnumerable<DashboardRankItem> items, bool hasCompare)
    {
        var ordered = items.Where(i => i.Current != 0 || (i.Previous ?? 0) != 0)
            .OrderByDescending(i => i.Current).ThenByDescending(i => i.Previous ?? 0).ToList();
        if (ordered.Count <= RankLimit + 1)
        {
            return ordered;
        }
        var rest = ordered.Skip(RankLimit).ToList();
        return ordered.Take(RankLimit)
            .Append(new DashboardRankItem(null, OtherName, rest.Sum(i => i.Current), hasCompare ? rest.Sum(i => i.Previous ?? 0) : null))
            .ToList();
    }

    private record NetLine(Guid DocumentId, Guid PartnerId, Guid? ItemId, DateOnly Date, bool IsInvoice, decimal Net);

    private static List<DashboardRankItem> RankBy(List<NetLine> lines, Func<NetLine, Guid> key, Period current, Period? compare) =>
        Rank(lines.GroupBy(key).Select(g => new DashboardRankItem(g.Key, string.Empty,
            g.Where(l => InPeriod(l.Date, current)).Sum(l => l.Net),
            compare is null ? null : g.Where(l => InPeriod(l.Date, compare)).Sum(l => l.Net))), compare is not null);

    private static async Task<List<DashboardRankItem>> NameAsync(List<DashboardRankItem> items, Task<Dictionary<Guid, string>> names)
    {
        var byId = await names;
        return items.Select(i => i.Id is { } id ? i with { Name = byId.GetValueOrDefault(id, "?") } : i).ToList();
    }

    private async Task<Dictionary<Guid, TaxDefinition>> TaxDefinitionsAsync(Guid companyId) =>
        await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId).ToDictionaryAsync(t => t.Id);

    private decimal LineNet(decimal quantity, decimal unitPrice, decimal discount, Guid? taxId, PriceMode mode,
        Dictionary<Guid, TaxDefinition> taxes) =>
        DocumentLineCalculator.Calculate(quantity, unitPrice, discount, Guid.Empty, string.Empty,
            taxId is { } id ? taxes.GetValueOrDefault(id) : null, false, true, _tax, Guid.Empty, Guid.Empty, mode).NetAmount;

    private async Task<List<NetLine>> InvoiceLinesAsync(Guid companyId, Period current, Period? compare)
    {
        var start = compare is null || current.From <= compare.From ? current.From : compare.From;
        var end = compare is null || current.To >= compare.To ? current.To : compare.To;
        var invoices = await _db.Invoices.AsNoTracking().VisibleTo(_access).Include(i => i.Lines)
            .Where(i => i.CompanyId == companyId && i.State == InvoiceState.Posted && i.IssueDate >= start && i.IssueDate <= end
                && (i.DocumentType == InvoiceDocumentType.Invoice || i.DocumentType == InvoiceDocumentType.DebitNote
                    || i.DocumentType == InvoiceDocumentType.CreditNote || i.DocumentType == InvoiceDocumentType.SalesReturn))
            .ToListAsync();
        var taxes = await TaxDefinitionsAsync(companyId);
        return invoices.SelectMany(i => i.Lines.Select(l => new NetLine(i.Id, i.PartnerId, l.ItemId, i.IssueDate,
                i.DocumentType == InvoiceDocumentType.Invoice,
                // Credit notes and sales returns post as reversals (Invoice.Post), so they subtract.
                (i.DocumentType is InvoiceDocumentType.CreditNote or InvoiceDocumentType.SalesReturn ? -1 : 1)
                    * LineNet(l.Quantity, l.UnitPrice, l.DiscountPercent, l.TaxDefinitionId, i.PriceMode, taxes))))
            .Where(l => InPeriod(l.Date, current) || (compare is not null && InPeriod(l.Date, compare)))
            .ToList();
    }

    private async Task<List<NetLine>> BillLinesAsync(Guid companyId, Period current, Period? compare)
    {
        var start = compare is null || current.From <= compare.From ? current.From : compare.From;
        var end = compare is null || current.To >= compare.To ? current.To : compare.To;
        var bills = await _db.Bills.AsNoTracking().VisibleTo(_access).Include(b => b.Lines)
            .Where(b => b.CompanyId == companyId && b.State == BillState.Posted && b.IssueDate >= start && b.IssueDate <= end)
            .ToListAsync();
        var taxes = await TaxDefinitionsAsync(companyId);
        return bills.SelectMany(b => b.Lines.Select(l => new NetLine(b.Id, b.PartnerId, l.ItemId, b.IssueDate,
                b.DocumentType == BillDocumentType.Bill,
                (b.DocumentType == BillDocumentType.Bill ? 1 : -1)
                    * LineNet(l.Quantity, l.UnitPrice, l.DiscountPercent, l.TaxDefinitionId, b.PriceMode, taxes))))
            .Where(l => InPeriod(l.Date, current) || (compare is not null && InPeriod(l.Date, compare)))
            .ToList();
    }

    // ---- Aging: what is still open at the period end, by days past due ----

    private static string AgingKey(DateOnly asOf, DateOnly due)
    {
        var days = asOf.DayNumber - due.DayNumber;
        return days <= 0 ? "notDue" : days <= 30 ? "d1to30" : days <= 60 ? "d31to60" : days <= 90 ? "d61to90" : "d90plus";
    }

    private static readonly string[] AgingKeys = ["notDue", "d1to30", "d31to60", "d61to90", "d90plus"];

    private static List<DashboardAgingBucket> Aging(IEnumerable<(DateOnly Due, decimal Open)> documents, DateOnly asOf)
    {
        var open = documents.Where(d => d.Open > 0.01m).ToList();
        return AgingKeys.Select(key =>
        {
            var inBucket = open.Where(d => AgingKey(asOf, d.Due) == key).ToList();
            return new DashboardAgingBucket(key, inBucket.Sum(d => d.Open), inBucket.Count);
        }).ToList();
    }

    // The document's own partner line on its journal entry is the amount owed; reconciliations
    // made up to the period end reduce it (the same rule as the debt-aging report).
    private async Task<List<DashboardAgingBucket>> ReceivablesAgingAsync(Guid companyId, DateOnly asOf)
    {
        var cutoff = asOf.ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc);
        var documents = await (
            from i in _db.Invoices.AsNoTracking().VisibleTo(_access)
            where i.CompanyId == companyId && i.State == InvoiceState.Posted && i.IssueDate <= asOf
                && (i.DocumentType == InvoiceDocumentType.Invoice || i.DocumentType == InvoiceDocumentType.DebitNote)
            join l in _db.JournalEntryLines on i.JournalEntryId equals l.JournalEntryId
            where l.PartnerId == i.PartnerId && l.Debit > 0
            group l by new { i.Id, i.DueDate } into g
            select new { g.Key.Id, g.Key.DueDate, Total = g.Sum(l => l.Debit) })
            .ToListAsync();
        var ids = documents.Select(d => d.Id).ToList();
        var reconciled = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId != null && ids.Contains(r.InvoiceId.Value) && r.ReconciledAt <= cutoff)
            .GroupBy(r => r.InvoiceId!.Value)
            .Select(g => new { Id = g.Key, Amount = g.Sum(r => r.Amount) })
            .ToDictionaryAsync(g => g.Id, g => g.Amount);
        return Aging(documents.Select(d => (d.DueDate, d.Total - reconciled.GetValueOrDefault(d.Id))), asOf);
    }

    private async Task<List<DashboardAgingBucket>> PayablesAgingAsync(Guid companyId, DateOnly asOf)
    {
        var cutoff = asOf.ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc);
        var documents = await (
            from b in _db.Bills.AsNoTracking().VisibleTo(_access)
            where b.CompanyId == companyId && b.State == BillState.Posted && b.IssueDate <= asOf
                && b.DocumentType == BillDocumentType.Bill
            join l in _db.JournalEntryLines on b.JournalEntryId equals l.JournalEntryId
            where l.PartnerId == b.PartnerId && l.Credit > 0
            group l by new { b.Id, b.DueDate } into g
            select new { g.Key.Id, g.Key.DueDate, Total = g.Sum(l => l.Credit) })
            .ToListAsync();
        var ids = documents.Select(d => d.Id).ToList();
        var reconciled = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.BillId != null && ids.Contains(r.BillId.Value) && r.ReconciledAt <= cutoff)
            .GroupBy(r => r.BillId!.Value)
            .Select(g => new { Id = g.Key, Amount = g.Sum(r => r.Amount) })
            .ToDictionaryAsync(g => g.Id, g => g.Amount);
        return Aging(documents.Select(d => (d.DueDate, d.Total - reconciled.GetValueOrDefault(d.Id))), asOf);
    }
}
