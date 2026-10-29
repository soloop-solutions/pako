using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports")]
[Authorize]
public class StatementReportsController : ControllerBase
{
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly LedgerAggregator _ledger;

    public StatementReportsController(IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, LedgerAggregator ledger)
    {
        _localizer = localizer;
        _access = access;
        _ledger = ledger;
    }

    private ObjectResult ReportNotAvailableForScopedUser() =>
        StatusCode(StatusCodes.Status403Forbidden, _localizer["ReportNotAvailableForScopedUser"].Value);

    private static Guid Id(int n) => new($"5b1f0c2e-1a11-4c01-9a03-{n:D12}");

    private IActionResult StubExport(string sheet, string file) =>
        File(ExcelExportService.BuildWorkbook(sheet, new[] { "Report" }, new List<IReadOnlyList<object?>> { new object?[] { "stub" } }),
            ExcelExportService.XlsxContentType, file);

    [HttpGet("profit-and-loss/monthly")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<MonthlyProfitAndLossResponse>> MonthlyProfitAndLoss(Guid companyId, [FromQuery] int year)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        if (year is < 1 or > 9999)
        {
            return BadRequest(new { error = _localizer["ReportYearInvalid"].Value });
        }

        var sums = await _ledger.SumsByAccountAndMonthAsync(companyId, year);

        List<MonthlyReportLine> Lines(Func<AccountType, bool> include, Func<MonthlyAccountSums, decimal> amount) =>
            sums.Where(s => include(s.Account.AccountType))
                .GroupBy(s => s.Account)
                .Select(g =>
                {
                    var months = Enumerable.Range(1, 12)
                        .Select(m => g.Where(x => x.Month == m).Sum(amount))
                        .ToList();
                    return new MonthlyReportLine(g.Key.Id, g.Key.Code, g.Key.Name, months, months.Sum());
                })
                .OrderBy(l => l.AccountCode)
                .ToList();

        var income = Lines(AccountTypeDerivation.IsIncome, s => s.Credit - s.Debit);
        var cost = Lines(t => t == AccountType.CostOfRevenue, s => s.Debit - s.Credit);
        var expenses = Lines(t => AccountTypeDerivation.IsExpense(t) && t != AccountType.CostOfRevenue, s => s.Debit - s.Credit);

        decimal MonthSum(List<MonthlyReportLine> lines, int m) => lines.Sum(l => l.Months[m]);
        var grossByMonth = Enumerable.Range(0, 12).Select(m => MonthSum(income, m) - MonthSum(cost, m)).ToList();
        var netByMonth = Enumerable.Range(0, 12).Select(m => grossByMonth[m] - MonthSum(expenses, m)).ToList();

        return Ok(new MonthlyProfitAndLossResponse(
            year, income, cost, expenses, grossByMonth, netByMonth, grossByMonth.Sum(), netByMonth.Sum()));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("profit-and-loss/monthly/export", Name = "MonthlyProfitAndLossExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> MonthlyProfitAndLossExport(Guid companyId, [FromQuery] int year)
    {
        var result = await MonthlyProfitAndLoss(companyId, year);
        if (result.Result is not OkObjectResult ok || ok.Value is not MonthlyProfitAndLossResponse response)
        {
            return result.Result!;
        }

        var headers = new[] { "Section", "Account Code", "Account Name" }
            .Concat(Enumerable.Range(1, 12).Select(m => new DateOnly(2000, m, 1).ToString("MMM", System.Globalization.CultureInfo.InvariantCulture)))
            .Append("Total")
            .ToArray();
        var rows = new List<IReadOnlyList<object?>>();
        void AddSection(string section, List<MonthlyReportLine> lines) =>
            rows.AddRange(lines.Select(l => (IReadOnlyList<object?>)new object?[] { section, l.AccountCode, l.AccountName }
                .Concat(l.Months.Cast<object?>()).Append(l.Total).ToArray()));
        AddSection("Income", response.Income);
        AddSection("Cost of Revenue", response.CostOfRevenue);
        rows.Add(new object?[] { null, null, "Gross Profit" }.Concat(response.GrossProfitByMonth.Cast<object?>()).Append(response.GrossProfit).ToArray());
        AddSection("Expenses", response.Expenses);
        rows.Add(new object?[] { null, null, "Net Income" }.Concat(response.NetIncomeByMonth.Cast<object?>()).Append(response.NetIncome).ToArray());

        var bytes = ExcelExportService.BuildWorkbook("Monthly P&L", headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"profit-and-loss-monthly-{year}.xlsx");
    }

    [HttpGet("balance-sheet/comparative")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<BalanceSheetComparativeResponse>> BalanceSheetComparative(
        Guid companyId, [FromQuery] DateOnly asOf, [FromQuery] DateOnly compareTo)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        var current = await _ledger.BalanceSheetAsync(companyId, asOf);
        var prior = await _ledger.BalanceSheetAsync(companyId, compareTo);

        static List<ComparativeLine> Zip(List<ReportLine> cur, List<ReportLine> pri)
        {
            var currentById = cur.ToDictionary(l => l.AccountId);
            var priorById = pri.ToDictionary(l => l.AccountId);
            return currentById.Keys.Union(priorById.Keys)
                .Select(id =>
                {
                    var meta = currentById.TryGetValue(id, out var c) ? c : priorById[id];
                    var curAmount = c?.Amount ?? 0m;
                    var priAmount = priorById.TryGetValue(id, out var p) ? p.Amount : 0m;
                    return new ComparativeLine(id, meta.AccountCode, meta.AccountName, curAmount, priAmount, curAmount - priAmount);
                })
                .OrderBy(l => l.AccountCode)
                .ToList();
        }

        return Ok(new BalanceSheetComparativeResponse(
            asOf, compareTo,
            Zip(current.Assets, prior.Assets),
            Zip(current.Liabilities, prior.Liabilities),
            Zip(current.Equity, prior.Equity),
            current.TotalAssets,
            current.TotalLiabilities + current.TotalEquity));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("balance-sheet/comparative/export", Name = "BalanceSheetComparativeExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> BalanceSheetComparativeExport(
        Guid companyId, [FromQuery] DateOnly asOf, [FromQuery] DateOnly compareTo)
    {
        var result = await BalanceSheetComparative(companyId, asOf, compareTo);
        if (result.Result is not OkObjectResult ok || ok.Value is not BalanceSheetComparativeResponse response)
        {
            return result.Result!;
        }

        var headers = new[] { "Section", "Account Code", "Account Name", "Current", "Prior", "Difference" };
        var rows = new List<IReadOnlyList<object?>>();
        void AddSection(string section, List<ComparativeLine> lines, string totalLabel)
        {
            rows.AddRange(lines.Select(l => (IReadOnlyList<object?>)new object?[] { section, l.AccountCode, l.AccountName, l.Current, l.Prior, l.Difference }));
            var cur = lines.Sum(l => l.Current);
            var pri = lines.Sum(l => l.Prior);
            rows.Add(new object?[] { section, null, totalLabel, cur, pri, cur - pri });
        }
        AddSection("Assets", response.Assets, "Total Assets");
        AddSection("Liabilities", response.Liabilities, "Total Liabilities");
        AddSection("Equity", response.Equity, "Total Equity");

        var bytes = ExcelExportService.BuildWorkbook("Comparative Balance Sheet", headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"balance-sheet-comparative-{asOf:yyyyMMdd}.xlsx");
    }

    [HttpGet("cash-flow")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<CashFlowResponse> CashFlow(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T7
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new CashFlowResponse(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), 30000.00m, 45000.00m,
            new() { new(Id(120), "120", "Trade receivables", -5000.00m), new(Id(400), "400", "Trade payables", 5000.00m) },
            new() { new(Id(210), "210", "Fixed assets", -10000.00m) },
            new() { new(Id(560), "560", "Retained earnings (dividends paid)", -20000.00m) },
            15000.00m, 45000.00m, 0.00m));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("cash-flow/export", Name = "CashFlowExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult CashFlowExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T7
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("Cash Flow", $"cash-flow-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("equity-statement")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<EquityStatementResponse> EquityStatement(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T7
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new EquityStatementResponse(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), 45000.00m, 45000.00m,
            new() { new(Id(560), "560", "Retained earnings (dividends paid)", -20000.00m) },
            70000.00m));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("equity-statement/export", Name = "EquityStatementExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult EquityStatementExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T7
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("Equity Statement", $"equity-statement-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("expense-book")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<ExpenseBookResponse> ExpenseBook(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T8
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        static Guid E(int n) => new($"5b1f0c2e-1a11-4c01-9a01-{n:D12}");
        return Ok(new ExpenseBookResponse(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 31),
            new()
            {
                new(Id(621), "621", "Rent"),
                new(Id(622), "622", "Salaries"),
                new(Id(631), "631", "Utilities"),
            },
            new()
            {
                new(E(11), new DateOnly(2026, 1, 2), "BILL-0001", "Prime Properties L.L.C.", new() { 1000.00m, 0.00m, 0.00m }, 1000.00m),
                new(E(12), new DateOnly(2026, 1, 31), null, null, new() { 0.00m, 3000.00m, 0.00m }, 3000.00m),
                new(E(13), new DateOnly(2026, 1, 15), "BILL-0002", "KEDS J.S.C.", new() { 0.00m, 0.00m, 240.00m }, 240.00m),
            },
            new() { 1000.00m, 3000.00m, 240.00m }));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("expense-book/export", Name = "ExpenseBookExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public IActionResult ExpenseBookExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T8
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return StubExport("Expense Book", $"expense-book-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("checks")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public ActionResult<ReportChecksResponse> Checks(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        // CONTRACT STUB — replaced in T9
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        return Ok(new ReportChecksResponse(new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), new()
        {
            new("trialBalanceBalanced", true, 0.00m, 0.00m),
            new("balanceSheetBalanced", true, 130000.00m, 130000.00m),
            new("cashFlowReconciles", true, 45000.00m, 45000.00m),
        }));
    }
}
