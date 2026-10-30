namespace Pako.Api.Contracts;

// Which parts of the dashboard this user may see; a hidden section comes back empty.
public record DashboardSections(bool Finance, bool Sales, bool Purchases, bool Payroll, bool Hr);

// One headline figure. Previous is the comparison period's value (null without a comparison);
// ChangePercent is computed here so the browser never divides money. Trend is the figure per
// bucket of the selected period, for sparklines.
public record DashboardKpi(string Key, decimal Current, decimal? Previous, decimal? ChangePercent, List<decimal> Trend);

// One time bucket. CashBalance is the closing cash and bank balance at End.
public record DashboardPoint(
    DateOnly Start, DateOnly End, decimal Revenue, decimal Expenses, decimal NetProfit, decimal CashBalance, decimal PayrollCost);

// A ranked row (customer, vendor, item, account, department). Id is null for the folded "other" row.
public record DashboardRankItem(Guid? Id, string Name, decimal Current, decimal? Previous);

// Open receivables or payables by days past due: notDue, d1to30, d31to60, d61to90, d90plus.
public record DashboardAgingBucket(string Key, decimal Amount, int Count);

public record DashboardResponse(
    DateOnly From,
    DateOnly To,
    DateOnly? CompareFrom,
    DateOnly? CompareTo,
    string Granularity,
    DashboardSections Sections,
    List<DashboardKpi> Kpis,
    List<DashboardPoint> Series,
    List<DashboardPoint>? CompareSeries,
    List<DashboardRankItem> RevenueByAccount,
    List<DashboardRankItem> ExpensesByAccount,
    List<DashboardRankItem> TopCustomers,
    List<DashboardRankItem> TopVendors,
    List<DashboardRankItem> TopItems,
    List<DashboardAgingBucket> ReceivablesAging,
    List<DashboardAgingBucket> PayablesAging,
    List<DashboardRankItem> HeadcountByDepartment);

// A widget on the company dashboard: what it shows (Key), how (Visual), its width in grid
// columns (1-4), and whether it draws the comparison period.
public record DashboardWidgetConfig(string Key, string Visual, int Size, bool ShowComparison);

public record DashboardLayoutResponse(List<DashboardWidgetConfig> Widgets, bool IsDefault, bool CanEdit, DateTime? UpdatedAt);

public record SaveDashboardLayoutRequest(List<DashboardWidgetConfig> Widgets);
