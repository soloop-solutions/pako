using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Reporting;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports")]
[Authorize]
public class ReportChecksController : ControllerBase
{
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly LedgerAggregator _ledger;
    private readonly TaxReportService _tax;

    public ReportChecksController(
        IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, LedgerAggregator ledger, TaxReportService tax)
    {
        _localizer = localizer;
        _access = access;
        _ledger = ledger;
        _tax = tax;
    }

    [HttpGet("checks")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<ReportChecksResponse>> Checks(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return StatusCode(StatusCodes.Status403Forbidden, _localizer["ReportNotAvailableForScopedUser"].Value);
        }

        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var balanceSheet = await _ledger.BalanceSheetAsync(companyId, to);
        var periodSums = await _ledger.SumsByAccountAsync(companyId, from, to);
        var priorEarnings = from == DateOnly.MinValue ? 0m : (await _ledger.BalanceSheetAsync(companyId, from.AddDays(-1))).CurrentEarnings;
        var cashFlow = await _ledger.CashFlowAsync(companyId, from, to);
        var cumulative = await _ledger.SumsByAccountAsync(companyId, null, to);
        var vat = await _tax.VatReturnAsync(companyId, from, to);
        var salesVat = (await _tax.BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: true)).Sum(r => r.VatAmount);
        var purchaseVat = (await _tax.BuildTaxBookRowsAsync(companyId, from, to, isSalesBook: false)).Sum(r => r.VatAmount);

        var checks = new[]
        {
            ReportReconciler.Equal("balance-sheet-balances", balanceSheet.TotalAssets, balanceSheet.TotalLiabilities + balanceSheet.TotalEquity),
            ReportReconciler.Equal("net-profit-consistent", LedgerAggregator.NetIncome(periodSums), balanceSheet.CurrentEarnings - priorEarnings),
            ReportReconciler.Equal("cash-flow-closes", cashFlow.Closing, cashFlow.Result.ClosingComputed),
            ReportReconciler.Equal("trial-balance-balances", cumulative.Sum(s => s.Debit), cumulative.Sum(s => s.Credit)),
            ReportReconciler.Equal("books-match-vat-return", vat.TotalOutputVat - vat.TotalInputVat, salesVat - purchaseVat),
        };

        return Ok(new ReportChecksResponse(from, to, checks.Select(c => new ReportCheck(c.Key, c.Passed, c.Expected, c.Actual)).ToList()));
    }
}
