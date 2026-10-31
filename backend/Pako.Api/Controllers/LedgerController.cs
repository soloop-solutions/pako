using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Ledger;
using Pako.Infrastructure;
using Pako.Domain.Hr;
using Pako.Domain.Reporting;
using Microsoft.Extensions.Localization;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/ledger")]
[Authorize]
public class LedgerController : ControllerBase
{
    private readonly PakoDbContext _db;

    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ExportLabels _labels;

    public LedgerController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, ExportLabels labels)
    {
        _labels = labels;
        _db = db;
        _localizer = localizer;
    }

    [HttpGet("trial-balance")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<List<TrialBalanceLine>>> TrialBalance(Guid companyId, [FromQuery] DateOnly? from = null, [FromQuery] DateOnly? to = null)
    {
        if (from is { } f && to is { } t && f > t)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        var start = from ?? DateOnly.MinValue;
        var query = _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntry!.CompanyId == companyId && l.JournalEntry.State == JournalEntryState.Posted);
        if (to is { } end)
        {
            query = query.Where(l => l.JournalEntry!.Date <= end);
        }

        var sums = await query
            .GroupBy(l => l.AccountId)
            .Select(g => new
            {
                AccountId = g.Key,
                OpeningDebit = g.Where(l => l.JournalEntry!.Date < start).Sum(l => l.Debit),
                OpeningCredit = g.Where(l => l.JournalEntry!.Date < start).Sum(l => l.Credit),
                Debit = g.Where(l => l.JournalEntry!.Date >= start).Sum(l => l.Debit),
                Credit = g.Where(l => l.JournalEntry!.Date >= start).Sum(l => l.Credit)
            })
            .ToListAsync();

        var accountIds = sums.Select(s => s.AccountId).ToList();
        var accounts = await _db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id);
        var groups = await _db.AccountGroups.AsNoTracking()
            .Where(g => g.CompanyId == companyId && g.ParentGroupId != null)
            .ToListAsync();

        var result = sums
            .Select(s => (Account: accounts[s.AccountId], Sums: s))
            .OrderBy(s => s.Account.CreatedAt)
            .ThenBy(s => s.Account.Code, StringComparer.Ordinal)
            .Select(s =>
            {
                var a = TrialBalanceCalculator.Line(s.Sums.OpeningDebit, s.Sums.OpeningCredit, s.Sums.Debit, s.Sums.Credit);
                var group = groups.FirstOrDefault(g =>
                    string.CompareOrdinal(s.Account.Code, g.CodePrefixStart) >= 0 && string.CompareOrdinal(s.Account.Code, g.CodePrefixEnd) <= 0);
                return new TrialBalanceLine(s.Account.Id, s.Account.Code, s.Account.Name, a.Debit, a.Credit, a.Balance, a.Opening, a.Closing, s.Account.Class, group?.Name);
            })
            .ToList();

        return Ok(result);
    }

    [ProducesXlsx]
    [HttpGet("trial-balance/export", Name = "TrialBalanceExport")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<IActionResult> TrialBalanceExport(Guid companyId, [FromQuery] DateOnly? from = null, [FromQuery] DateOnly? to = null)
    {
        var result = await TrialBalance(companyId, from, to);
        if (result.Result is not OkObjectResult ok || ok.Value is not List<TrialBalanceLine> lines)
        {
            return result.Result!;
        }

        var headers = new[] { _labels["Common_AccountCode"], _labels["Common_AccountName"], _labels["Common_Opening"], _labels["Common_Debit"], _labels["Common_Credit"], _labels["Common_Closing"] };
        var rows = new List<IReadOnlyList<object?>>();
        var groups = TrialBalanceCalculator.Groups(
            lines, l => l.Class, l => l.GroupName, l => new TrialBalanceAmounts(l.Opening, l.Debit, l.Credit, l.Balance, l.Closing));
        foreach (var group in groups)
        {
            rows.AddRange(group.Lines.Select(l => (IReadOnlyList<object?>)new object?[] { l.AccountCode, l.AccountName, l.Opening, l.Debit, l.Credit, l.Closing }));
            var groupLabel = group.GroupName ?? (group.Class is { } cls ? string.Format(_labels["Tb_Class"], cls) : null);
            if (groupLabel is not null)
            {
                rows.Add(new object?[] { string.Format(_labels["Tb_TotalGroup"], groupLabel), null, group.Total.Opening, group.Total.Debit, group.Total.Credit, group.Total.Closing });
            }
        }

        var total = TrialBalanceCalculator.Total(lines.Select(l => new TrialBalanceAmounts(l.Opening, l.Debit, l.Credit, l.Balance, l.Closing)));
        rows.Add(new object?[] { _labels["Common_Total"], null, total.Opening, total.Debit, total.Credit, total.Closing });

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_TrialBalance"], headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, TrialBalanceFileName(from, to));
    }

    private static string TrialBalanceFileName(DateOnly? from, DateOnly? to) => (from, to) switch
    {
        ({ } f, { } t) => $"trial-balance-{f:yyyyMMdd}-{t:yyyyMMdd}.xlsx",
        ({ } f, null) => $"trial-balance-from-{f:yyyyMMdd}.xlsx",
        (null, { } t) => $"trial-balance-to-{t:yyyyMMdd}.xlsx",
        _ => "trial-balance.xlsx"
    };

    [HttpGet("trial-balance/totals", Name = "TrialBalanceTotals")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<TrialBalanceTotals>> TrialBalanceTotalsAction(Guid companyId, [FromQuery] DateOnly? from = null, [FromQuery] DateOnly? to = null)
    {
        var result = await TrialBalance(companyId, from, to);
        if (result.Result is not OkObjectResult ok || ok.Value is not List<TrialBalanceLine> lines)
        {
            return result.Result!;
        }

        var total = TrialBalanceCalculator.Total(lines.Select(l => new TrialBalanceAmounts(l.Opening, l.Debit, l.Credit, l.Balance, l.Closing)));
        return Ok(new TrialBalanceTotals(total.Opening, total.Debit, total.Credit, total.Closing));
    }
}
