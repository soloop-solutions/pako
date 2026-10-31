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
    private readonly ExportLabels _labels;

    public StatementReportsController(IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, LedgerAggregator ledger, ExportLabels labels)
    {
        _labels = labels;
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
                    var months = Pako.Domain.Reporting.MonthlyProfitAndLoss.Months(g.Select(x => (x.Month, amount(x))));
                    return new MonthlyReportLine(g.Key.Id, g.Key.Code, g.Key.Name, months, months.Sum());
                })
                .OrderBy(l => l.AccountCode)
                .ToList();

        var income = Lines(AccountTypeDerivation.IsIncome, s => s.Credit - s.Debit);
        var cost = Lines(t => t == AccountType.CostOfRevenue, s => s.Debit - s.Credit);
        var expenses = Lines(t => AccountTypeDerivation.IsExpense(t) && t != AccountType.CostOfRevenue, s => s.Debit - s.Credit);

        var pnl = Pako.Domain.Reporting.MonthlyProfitAndLoss.Calculate(
            income.Select(l => (IReadOnlyList<decimal>)l.Months),
            cost.Select(l => (IReadOnlyList<decimal>)l.Months),
            expenses.Select(l => (IReadOnlyList<decimal>)l.Months));

        return Ok(new MonthlyProfitAndLossResponse(
            year, income, cost, expenses, pnl.GrossProfitByMonth, pnl.NetIncomeByMonth, pnl.GrossProfit, pnl.NetIncome,
            pnl.IncomeByMonth, pnl.CostOfRevenueByMonth, pnl.ExpensesByMonth,
            pnl.TotalIncome, pnl.TotalCostOfRevenue, pnl.TotalExpenses));
    }

    [ProducesXlsx]
    [HttpGet("profit-and-loss/monthly/export", Name = "MonthlyProfitAndLossExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> MonthlyProfitAndLossExport(Guid companyId, [FromQuery] int year)
    {
        var result = await MonthlyProfitAndLoss(companyId, year);
        if (result.Result is not OkObjectResult ok || ok.Value is not MonthlyProfitAndLossResponse response)
        {
            return result.Result!;
        }

        var headers = new[] { _labels["Common_Section"], _labels["Common_AccountCode"], _labels["Common_AccountName"] }
            .Concat(Enumerable.Range(1, 12).Select(_labels.Month))
            .Append(_labels["Common_Total"])
            .ToArray();
        var rows = new List<IReadOnlyList<object?>>();
        void AddSection(string section, List<MonthlyReportLine> lines) =>
            rows.AddRange(lines.Select(l => (IReadOnlyList<object?>)new object?[] { section, l.AccountCode, l.AccountName }
                .Concat(l.Months.Cast<object?>()).Append(l.Total).ToArray()));
        AddSection(_labels["Common_Income"], response.Income);
        AddSection(_labels["Pnl_CostOfRevenue"], response.CostOfRevenue);
        rows.Add(new object?[] { null, null, _labels["Pnl_GrossProfit"] }.Concat(response.GrossProfitByMonth.Cast<object?>()).Append(response.GrossProfit).ToArray());
        AddSection(_labels["Common_Expenses"], response.Expenses);
        rows.Add(new object?[] { null, null, _labels["Common_NetIncome"] }.Concat(response.NetIncomeByMonth.Cast<object?>()).Append(response.NetIncome).ToArray());

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_MonthlyPnl"], headers, rows);
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
                    return new ComparativeLine(id, meta.AccountCode, meta.AccountName, curAmount, priAmount, ComparativeStatement.Difference(curAmount, priAmount));
                })
                .OrderBy(l => l.AccountCode)
                .ToList();
        }

        static ComparativeTotals Totals(List<ComparativeLine> lines)
        {
            var t = ComparativeStatement.Totals(lines.Select(l => (l.Current, l.Prior)));
            return new ComparativeTotals(t.Current, t.Prior, t.Difference);
        }

        var assets = Zip(current.Assets, prior.Assets);
        var liabilities = Zip(current.Liabilities, prior.Liabilities);
        var equity = Zip(current.Equity, prior.Equity);

        return Ok(new BalanceSheetComparativeResponse(
            asOf, compareTo, assets, liabilities, equity,
            current.TotalAssets,
            current.TotalLiabilities + current.TotalEquity,
            Totals(assets), Totals(liabilities), Totals(equity)));
    }

    [ProducesXlsx]
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

        var headers = new[] { _labels["Common_Section"], _labels["Common_AccountCode"], _labels["Common_AccountName"], _labels["Common_Current"], _labels["Common_Prior"], _labels["Common_Difference"] };
        var rows = new List<IReadOnlyList<object?>>();
        void AddSection(string section, List<ComparativeLine> lines, string totalLabel)
        {
            rows.AddRange(lines.Select(l => (IReadOnlyList<object?>)new object?[] { section, l.AccountCode, l.AccountName, l.Current, l.Prior, l.Difference }));
            var totals = ComparativeStatement.Totals(lines.Select(l => (l.Current, l.Prior)));
            rows.Add(new object?[] { section, null, totalLabel, totals.Current, totals.Prior, totals.Difference });
        }
        AddSection(_labels["Common_Assets"], response.Assets, _labels["Common_TotalAssets"]);
        AddSection(_labels["Common_Liabilities"], response.Liabilities, _labels["Common_TotalLiabilities"]);
        AddSection(_labels["Common_Equity"], response.Equity, _labels["Common_TotalEquity"]);

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_ComparativeBalanceSheet"], headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"balance-sheet-comparative-{asOf:yyyyMMdd}-{compareTo:yyyyMMdd}.xlsx");
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

    [ProducesXlsx]
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
            new object?[] { _labels["Common_Opening"], null, _labels["Cf_OpeningCash"], r.OpeningCash },
            new object?[] { _labels["Cf_Operating"], null, _labels["Common_NetIncome"], r.NetIncome },
        };
        void AddSection(string section, List<CashFlowLine> lines, string totalLabel)
        {
            rows.AddRange(lines.Select(l => (IReadOnlyList<object?>)new object?[] { section, l.AccountCode, l.AccountName, l.Amount }));
            rows.Add(new object?[] { section, null, totalLabel, lines.Sum(l => l.Amount) });
        }
        AddSection(_labels["Cf_Operating"], r.Operating, _labels["Cf_TotalOperating"]);
        AddSection(_labels["Cf_Investing"], r.Investing, _labels["Cf_TotalInvesting"]);
        AddSection(_labels["Cf_Financing"], r.Financing, _labels["Cf_TotalFinancing"]);
        rows.Add(new object?[] { _labels["Cf_Summary"], null, _labels["Cf_NetChange"], r.NetChange });
        rows.Add(new object?[] { _labels["Cf_Summary"], null, _labels["Cf_ClosingCash"], r.ClosingCash });
        rows.Add(new object?[] { _labels["Cf_Summary"], null, _labels["Common_Difference"], r.Difference });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_CashFlow"], new[] { _labels["Common_Section"], _labels["Common_AccountCode"], _labels["Common_AccountName"], _labels["Common_Amount"] }, rows);
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
        var opening = Pako.Domain.Reporting.EquityStatement.Opening(
            prior.Where(s => AccountTypeDerivation.IsAsset(s.Account.AccountType)).Select(s => (s.Debit, s.Credit)),
            prior.Where(s => AccountTypeDerivation.IsLiability(s.Account.AccountType)).Select(s => (s.Debit, s.Credit)));

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

    [ProducesXlsx]
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
            new object?[] { _labels["Common_Opening"], null, _labels["Eq_OpeningEquity"], r.OpeningEquity },
            new object?[] { _labels["Eq_Result"], null, _labels["Common_NetIncome"], r.NetIncome },
        };
        rows.AddRange(r.Movements.Select(m => (IReadOnlyList<object?>)new object?[] { _labels["Eq_Movements"], m.AccountCode, m.AccountName, m.Amount }));
        rows.Add(new object?[] { _labels["Common_Closing"], null, _labels["Eq_ClosingEquity"], r.ClosingEquity });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_EquityStatement"], new[] { _labels["Common_Section"], _labels["Common_AccountCode"], _labels["Common_AccountName"], _labels["Common_Amount"] }, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"equity-statement-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }
}
