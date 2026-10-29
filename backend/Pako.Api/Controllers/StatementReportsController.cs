using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Reporting;

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

    private BadRequestObjectResult InvalidDateRange() =>
        BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });

    [HttpGet("cash-flow")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<CashFlowResponse>> CashFlow(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        if (from > to)
        {
            return InvalidDateRange();
        }

        var computed = await _ledger.CashFlowAsync(companyId, from, to);
        var opening = computed.Opening;
        var netIncome = computed.NetIncome;
        var closing = computed.Closing;
        var result = computed.Result;

        static List<CashFlowLine> Lines(IEnumerable<AccountMovement> list) =>
            list.Select(m => new CashFlowLine(m.AccountId, m.Code, m.Name, m.Credit - m.Debit)).ToList();

        return Ok(new CashFlowResponse(
            from, to, opening, netIncome,
            Lines(result.Operating), Lines(result.Investing), Lines(result.Financing),
            result.NetChange, closing, result.Difference));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("cash-flow/export", Name = "CashFlowExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> CashFlowExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var result = await CashFlow(companyId, from, to);
        if (result.Result is not OkObjectResult ok || ok.Value is not CashFlowResponse r)
        {
            return result.Result!;
        }

        var rows = new List<IReadOnlyList<object?>>
        {
            new object?[] { "Opening", null, "Opening Cash", r.OpeningCash },
            new object?[] { "Operating", null, "Net Income", r.NetIncome },
        };
        void AddSection(string section, List<CashFlowLine> lines, string totalLabel)
        {
            rows.AddRange(lines.Select(l => (IReadOnlyList<object?>)new object?[] { section, l.AccountCode, l.AccountName, l.Amount }));
            rows.Add(new object?[] { section, null, totalLabel, lines.Sum(l => l.Amount) });
        }
        AddSection("Operating", r.Operating, "Total Operating Adjustments");
        AddSection("Investing", r.Investing, "Total Investing");
        AddSection("Financing", r.Financing, "Total Financing");
        rows.Add(new object?[] { "Summary", null, "Net Change", r.NetChange });
        rows.Add(new object?[] { "Summary", null, "Closing Cash", r.ClosingCash });
        rows.Add(new object?[] { "Summary", null, "Difference", r.Difference });

        var bytes = ExcelExportService.BuildWorkbook("Cash Flow", new[] { "Section", "Account Code", "Account Name", "Amount" }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"cash-flow-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    [HttpGet("equity-statement")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<EquityStatementResponse>> EquityStatement(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        if (from > to)
        {
            return InvalidDateRange();
        }

        var prior = from == DateOnly.MinValue ? new List<AccountSums>() : await _ledger.SumsByAccountAsync(companyId, null, from.AddDays(-1));
        var opening =
            prior.Where(s => AccountTypeDerivation.IsAsset(s.Account.AccountType)).Sum(s => s.Debit - s.Credit) -
            prior.Where(s => AccountTypeDerivation.IsLiability(s.Account.AccountType)).Sum(s => s.Credit - s.Debit);

        var period = await _ledger.SumsByAccountAsync(companyId, from, to);
        var netIncome = LedgerAggregator.NetIncome(period);
        var movements = period
            .Where(s => s.Account.AccountType == AccountType.Equity && (s.Debit != 0m || s.Credit != 0m))
            .OrderBy(s => s.Account.Code, StringComparer.Ordinal)
            .Select(s => new EquityMovementLine(s.Account.Id, s.Account.Code, s.Account.Name, s.Credit - s.Debit))
            .ToList();

        var closing = Pako.Domain.Reporting.EquityStatement.Closing(opening, netIncome, movements.Select(m => m.Amount));
        return Ok(new EquityStatementResponse(from, to, opening, netIncome, movements, closing));
    }

    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("equity-statement/export", Name = "EquityStatementExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> EquityStatementExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var result = await EquityStatement(companyId, from, to);
        if (result.Result is not OkObjectResult ok || ok.Value is not EquityStatementResponse r)
        {
            return result.Result!;
        }

        var rows = new List<IReadOnlyList<object?>>
        {
            new object?[] { "Opening", null, "Opening Equity", r.OpeningEquity },
            new object?[] { "Result", null, "Net Income", r.NetIncome },
        };
        rows.AddRange(r.Movements.Select(m => (IReadOnlyList<object?>)new object?[] { "Movements", m.AccountCode, m.AccountName, m.Amount }));
        rows.Add(new object?[] { "Closing", null, "Closing Equity", r.ClosingEquity });

        var bytes = ExcelExportService.BuildWorkbook("Equity Statement", new[] { "Section", "Account Code", "Account Name", "Amount" }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"equity-statement-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }
}
