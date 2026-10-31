using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Reporting;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports")]
[Authorize]
public class ExpenseBookController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly ExportLabels _labels;

    public ExpenseBookController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, ExportLabels labels)
    {
        _labels = labels;
        _db = db;
        _localizer = localizer;
        _access = access;
    }

    [HttpGet("expense-book")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<ExpenseBookResponse>> ExpenseBook(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        if (_access.IsPartnerRestricted)
        {
            return StatusCode(StatusCodes.Status403Forbidden, _localizer["ReportNotAvailableForScopedUser"].Value);
        }

        if (from > to)
        {
            return BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });
        }

        return Ok(await BuildAsync(companyId, from, to));
    }

    [ProducesXlsx]
    [HttpGet("expense-book/export", Name = "ExpenseBookExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> ExpenseBookExport(Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
    {
        var result = await ExpenseBook(companyId, from, to);
        if (result.Result is not OkObjectResult ok || ok.Value is not ExpenseBookResponse book)
        {
            return result.Result!;
        }

        var headers = new List<string> { _labels["Common_Date"], _labels["Common_Document"], _labels["Common_Partner"] };
        headers.AddRange(book.Columns.Select(c => $"{c.AccountCode} - {c.AccountName}"));
        headers.Add(_labels["Common_Total"]);

        var rows = new List<IReadOnlyList<object?>>();
        foreach (var r in book.Rows)
        {
            var cells = new List<object?> { r.Date, r.DocumentNumber, r.PartnerName };
            cells.AddRange(r.Amounts.Cast<object?>());
            cells.Add(r.Total);
            rows.Add(cells);
        }

        var totals = new List<object?> { null, _labels["Common_Total"], null };
        totals.AddRange(book.ColumnTotals.Cast<object?>());
        totals.Add(book.GrandTotal);
        rows.Add(totals);

        var bytes = ExcelExportService.BuildWorkbook(_labels["Sheet_ExpenseBook"], headers, rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"expense-book-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    private async Task<ExpenseBookResponse> BuildAsync(Guid companyId, DateOnly from, DateOnly to)
    {
        var lines = await (
            from line in _db.JournalEntryLines.AsNoTracking()
            join entry in _db.JournalEntries.AsNoTracking() on line.JournalEntryId equals entry.Id
            join account in _db.Accounts.AsNoTracking() on line.AccountId equals account.Id
            where entry.CompanyId == companyId
                && entry.State == JournalEntryState.Posted
                && entry.Date >= @from && entry.Date <= to
            select new
            {
                EntryId = entry.Id,
                entry.Date,
                entry.Reference,
                entry.SecureSequenceNumber,
                LineId = line.Id,
                line.PartnerId,
                line.Debit,
                line.Credit,
                AccountId = account.Id,
                account.Code,
                account.Name,
                account.AccountType
            }).ToListAsync();

        var columns = lines
            .Where(l => AccountTypeDerivation.IsOperatingExpense(l.AccountType))
            .Select(l => new ExpenseBookColumn(l.AccountId, l.Code, l.Name))
            .DistinctBy(c => c.AccountId)
            .OrderBy(c => c.AccountCode, StringComparer.Ordinal)
            .ToList();
        var index = columns.Select((c, i) => (c.AccountId, i)).ToDictionary(x => x.AccountId, x => x.i);

        var entries = lines
            .GroupBy(l => l.EntryId)
            .Where(g => g.Any(l => index.ContainsKey(l.AccountId) && AccountTypeDerivation.IsOperatingExpense(l.AccountType)))
            .Select(g => g.OrderBy(l => l.LineId).ToList())
            .OrderBy(g => g[0].Date)
            .ThenBy(g => g[0].SecureSequenceNumber is null)
            .ThenBy(g => g[0].SecureSequenceNumber)
            .ThenBy(g => g[0].EntryId)
            .ToList();

        var partnerIds = entries.SelectMany(g => g).Where(l => l.PartnerId != null).Select(l => l.PartnerId!.Value).Distinct().ToList();
        var partnerNames = await _db.Partners.AsNoTracking()
            .Where(p => partnerIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name);

        var rows = new List<ExpenseBookRow>();
        var amountRows = new List<decimal[]>();
        foreach (var g in entries)
        {
            var amounts = new decimal[columns.Count];
            foreach (var l in g)
            {
                if (AccountTypeDerivation.IsOperatingExpense(l.AccountType))
                {
                    amounts[index[l.AccountId]] += l.Debit - l.Credit;
                }
            }

            amountRows.Add(amounts);
            var partnerId = g.Select(l => l.PartnerId).FirstOrDefault(p => p != null);
            var partnerName = partnerId is { } pid ? partnerNames.GetValueOrDefault(pid) : null;
            rows.Add(new ExpenseBookRow(g[0].EntryId, g[0].Date, g[0].Reference, partnerName, amounts.ToList(), ExpenseBookTotals.Row(amounts)));
        }

        var columnTotals = ExpenseBookTotals.Columns(amountRows, columns.Count);
        return new ExpenseBookResponse(from, to, columns, rows, columnTotals, ExpenseBookTotals.Grand(columnTotals));
    }
}
