using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Ledger;
using Pako.Domain.Reporting;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/reports")]
[Authorize]
public class GeneralLedgerReportController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly ExportLabels _labels;

    public GeneralLedgerReportController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, ExportLabels labels)
    {
        _labels = labels;
        _db = db;
        _localizer = localizer;
        _access = access;
    }

    private ObjectResult ReportNotAvailableForScopedUser() =>
        StatusCode(StatusCodes.Status403Forbidden, _localizer["ReportNotAvailableForScopedUser"].Value);

    private BadRequestObjectResult InvalidDateRange() =>
        BadRequest(new { error = _localizer["ReportDateRangeInvalid"].Value });

    [HttpGet("general-ledger")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<ActionResult<GeneralLedgerResponse>> GeneralLedger(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] Guid? accountId, [FromQuery] Guid? partnerId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null, [FromQuery] string? sort = null)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        if (from > to)
        {
            return InvalidDateRange();
        }

        page = Math.Clamp(page, 1, 1_000_000);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = Filtered(companyId, from, to, accountId, partnerId, search);

        var descending = sort is not null && sort.StartsWith('-');
        var sortField = descending ? sort![1..] : sort;
        var ordered = sortField?.ToLowerInvariant() switch
        {
            "account" => descending ? query.OrderByDescending(r => r.Account.Code) : query.OrderBy(r => r.Account.Code),
            "debit" => descending ? query.OrderByDescending(r => r.Line.Debit) : query.OrderBy(r => r.Line.Debit),
            "credit" => descending ? query.OrderByDescending(r => r.Line.Credit) : query.OrderBy(r => r.Line.Credit),
            _ => descending ? query.OrderByDescending(r => r.Entry.Date) : query.OrderBy(r => r.Entry.Date)
        };
        ordered = descending
            ? ((IOrderedQueryable<Row>)ordered).ThenByDescending(r => r.Entry.SecureSequenceNumber).ThenByDescending(r => r.Line.Id)
            : ((IOrderedQueryable<Row>)ordered).ThenBy(r => r.Entry.SecureSequenceNumber).ThenBy(r => r.Line.Id);

        var total = await query.CountAsync();
        var totalDebit = await query.SumAsync(r => r.Line.Debit);
        var totalCredit = await query.SumAsync(r => r.Line.Credit);
        var flat = await ordered.Skip((page - 1) * pageSize).Take(pageSize).Select(Projection).ToListAsync();
        var rows = await ToLinesAsync(flat);

        return Ok(new GeneralLedgerResponse(rows, total, page, pageSize, totalDebit, totalCredit));
    }

    [ProducesXlsx]
    [HttpGet("general-ledger/export", Name = "GeneralLedgerExport")]
    [RequireCompanyAccess(module: AccessModule.Reports)]
    public async Task<IActionResult> GeneralLedgerExport(
        Guid companyId, [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] Guid? accountId, [FromQuery] Guid? partnerId)
    {
        if (_access.IsPartnerRestricted)
        {
            return ReportNotAvailableForScopedUser();
        }

        if (from > to)
        {
            return InvalidDateRange();
        }

        var flat = await Filtered(companyId, from, to, accountId, partnerId, null)
            .OrderBy(r => r.Entry.Date).ThenBy(r => r.Entry.SecureSequenceNumber).ThenBy(r => r.Line.Id)
            .Select(Projection)
            .ToListAsync();
        var lines = await ToLinesAsync(flat);

        var rows = lines
            .Select(l => (IReadOnlyList<object?>)new object?[]
            {
                l.Date, l.EntryNumber, l.DocumentType, l.DocumentNumber, l.AccountCode, l.AccountName, l.PartnerName, l.Description, l.Debit, l.Credit
            })
            .ToList();
        var totals = ReportTotals.Ledger(lines.Select(l => (l.Debit, l.Credit)));
        rows.Add(new object?[] { null, null, null, null, null, null, null, _labels["Common_Total"], totals.Debit, totals.Credit });

        var bytes = ExcelExportService.BuildWorkbook(
            _labels["Sheet_GeneralLedger"],
            new[]
            {
                _labels["Common_Date"], _labels["Gl_Entry"], _labels["Gl_DocumentType"], _labels["Gl_DocumentNumber"], _labels["Gl_AccountCode"],
                _labels["Gl_AccountName"], _labels["Common_Partner"], _labels["Common_Description"], _labels["Common_Debit"], _labels["Common_Credit"]
            },
            rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"general-ledger-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    private sealed class Row
    {
        public JournalEntryLine Line { get; set; } = null!;
        public JournalEntry Entry { get; set; } = null!;
        public Account Account { get; set; } = null!;
        public Partner? Partner { get; set; }
        public JournalType JournalType { get; set; }
    }

    private sealed record Flat(
        Guid EntryId, string? EntryNumber, DateOnly Date, string? Reference, string AccountCode, string AccountName,
        Guid? PartnerId, string? PartnerName, string? Description, decimal Debit, decimal Credit,
        Guid? SourceDocumentId, JournalType JournalType);

    private static readonly System.Linq.Expressions.Expression<Func<Row, Flat>> Projection = r => new Flat(
        r.Entry.Id, r.Entry.SequenceNumber, r.Entry.Date, r.Entry.Reference, r.Account.Code, r.Account.Name,
        r.Line.PartnerId, r.Partner != null ? r.Partner.Name : null, r.Line.Description ?? r.Entry.Remarks,
        r.Line.Debit, r.Line.Credit, r.Entry.SourceDocumentId, r.JournalType);

    private async Task<List<GeneralLedgerLine>> ToLinesAsync(List<Flat> flat)
    {
        var sourceIds = flat.Where(f => f.SourceDocumentId != null).Select(f => f.SourceDocumentId!.Value).Distinct().ToList();
        var invoiceTypes = sourceIds.Count == 0 ? new Dictionary<Guid, string>() : (await _db.Invoices.AsNoTracking()
            .Where(i => sourceIds.Contains(i.Id)).Select(i => new { i.Id, i.DocumentType }).ToListAsync())
            .ToDictionary(i => i.Id, i => i.DocumentType.ToString());
        var billTypes = sourceIds.Count == 0 ? new Dictionary<Guid, string>() : (await _db.Bills.AsNoTracking()
            .Where(b => sourceIds.Contains(b.Id)).Select(b => new { b.Id, b.DocumentType }).ToListAsync())
            .ToDictionary(b => b.Id, b => b.DocumentType.ToString());

        return flat.Select(f =>
        {
            string? invoiceType = null, billType = null;
            if (f.SourceDocumentId is { } sid)
            {
                invoiceType = invoiceTypes.GetValueOrDefault(sid);
                billType = invoiceType is null ? billTypes.GetValueOrDefault(sid) : null;
            }

            return new GeneralLedgerLine(
                f.EntryId, f.EntryNumber, f.Date, f.Reference, f.AccountCode, f.AccountName, f.PartnerId, f.PartnerName,
                f.Description, f.Debit, f.Credit,
                LedgerDocumentType.Classify(invoiceType, billType, f.SourceDocumentId != null, f.JournalType),
                f.Reference ?? f.EntryNumber);
        }).ToList();
    }

    private IQueryable<Row> Filtered(Guid companyId, DateOnly from, DateOnly to, Guid? accountId, Guid? partnerId, string? search)
    {
        var query =
            from line in _db.JournalEntryLines.AsNoTracking()
            join entry in _db.JournalEntries.AsNoTracking() on line.JournalEntryId equals entry.Id
            join account in _db.Accounts.AsNoTracking() on line.AccountId equals account.Id
            join journal in _db.Journals.AsNoTracking() on entry.JournalId equals journal.Id
            join partner in _db.Partners.AsNoTracking() on line.PartnerId equals partner.Id into partners
            from partner in partners.DefaultIfEmpty()
            where entry.CompanyId == companyId
                && entry.State == JournalEntryState.Posted
                && entry.Date >= @from && entry.Date <= to
            select new Row { Line = line, Entry = entry, Account = account, Partner = partner, JournalType = journal.Type };

        if (accountId is { } a)
        {
            query = query.Where(r => r.Line.AccountId == a);
        }

        if (partnerId is { } p)
        {
            query = query.Where(r => r.Line.PartnerId == p);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var escaped = search.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
            var pattern = $"%{escaped}%";
            query = query.Where(r =>
                EF.Functions.ILike(r.Account.Code, pattern, "\\") ||
                EF.Functions.ILike(r.Account.Name, pattern, "\\") ||
                (r.Partner != null && EF.Functions.ILike(r.Partner.Name, pattern, "\\")) ||
                (r.Line.Description != null && EF.Functions.ILike(r.Line.Description, pattern, "\\")) ||
                (r.Line.Description == null && r.Entry.Remarks != null && EF.Functions.ILike(r.Entry.Remarks, pattern, "\\")) ||
                (r.Entry.Reference != null && EF.Functions.ILike(r.Entry.Reference, pattern, "\\")));
        }

        return query;
    }
}
