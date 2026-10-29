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

    public GeneralLedgerReportController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access)
    {
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
    public async Task<ActionResult<PaginatedResponse<GeneralLedgerLine>>> GeneralLedger(
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

        page = Math.Max(page, 1);
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
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).Select(Projection).ToListAsync();

        return Ok(new PaginatedResponse<GeneralLedgerLine>(rows, total, page, pageSize));
    }

    [Produces(ExcelExportService.XlsxContentType)]
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

        var lines = await Filtered(companyId, from, to, accountId, partnerId, null)
            .OrderBy(r => r.Entry.Date).ThenBy(r => r.Entry.SecureSequenceNumber).ThenBy(r => r.Line.Id)
            .Select(Projection)
            .ToListAsync();

        var rows = lines
            .Select(l => (IReadOnlyList<object?>)new object?[]
            {
                l.Date.ToString("yyyy-MM-dd"), l.EntryNumber, l.AccountCode, l.AccountName, l.PartnerName, l.Description, l.Debit, l.Credit
            })
            .ToList();

        var bytes = ExcelExportService.BuildWorkbook(
            "General Ledger",
            new[] { "Date", "Entry", "Account code", "Account name", "Partner", "Description", "Debit", "Credit" },
            rows);
        return File(bytes, ExcelExportService.XlsxContentType, $"general-ledger-{from:yyyyMMdd}-{to:yyyyMMdd}.xlsx");
    }

    private sealed class Row
    {
        public JournalEntryLine Line { get; set; } = null!;
        public JournalEntry Entry { get; set; } = null!;
        public Account Account { get; set; } = null!;
        public Partner? Partner { get; set; }
    }

    private static readonly System.Linq.Expressions.Expression<Func<Row, GeneralLedgerLine>> Projection = r => new GeneralLedgerLine(
        r.Entry.Id, r.Entry.SequenceNumber, r.Entry.Date, r.Entry.Reference, r.Account.Code, r.Account.Name,
        r.Line.PartnerId, r.Partner != null ? r.Partner.Name : null, r.Line.Description ?? r.Entry.Remarks,
        r.Line.Debit, r.Line.Credit);

    private IQueryable<Row> Filtered(Guid companyId, DateOnly from, DateOnly to, Guid? accountId, Guid? partnerId, string? search)
    {
        var query =
            from line in _db.JournalEntryLines.AsNoTracking()
            join entry in _db.JournalEntries.AsNoTracking() on line.JournalEntryId equals entry.Id
            join account in _db.Accounts.AsNoTracking() on line.AccountId equals account.Id
            join partner in _db.Partners.AsNoTracking() on line.PartnerId equals partner.Id into partners
            from partner in partners.DefaultIfEmpty()
            where entry.CompanyId == companyId
                && entry.State == JournalEntryState.Posted
                && entry.Date >= @from && entry.Date <= to
            select new Row { Line = line, Entry = entry, Account = account, Partner = partner };

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
            var pattern = $"%{search.Trim()}%";
            query = query.Where(r =>
                EF.Functions.ILike(r.Account.Code, pattern) ||
                EF.Functions.ILike(r.Account.Name, pattern) ||
                (r.Partner != null && EF.Functions.ILike(r.Partner.Name, pattern)) ||
                (r.Line.Description != null && EF.Functions.ILike(r.Line.Description, pattern)) ||
                (r.Entry.Reference != null && EF.Functions.ILike(r.Entry.Reference, pattern)));
        }

        return query;
    }
}
