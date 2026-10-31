using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Microsoft.Extensions.Localization;
using Pako.Api.Services;
using Pako.Domain.Ledger;
using Pako.Infrastructure;
using Pako.Domain.Hr;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/journal-entries")]
[Authorize]
public class JournalEntriesController : ControllerBase
{
    private const decimal MaxLineAmount = 9999999999999999.99m;

    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numberSeries;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly ExportLabels _labels;

    public JournalEntriesController(PakoDbContext db, NumberSeriesService numberSeries, IStringLocalizer<ErrorMessages> localizer, ExportLabels labels)
    {
        _labels = labels;
        _db = db;
        _numberSeries = numberSeries;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<ActionResult<List<JournalEntryResponse>>> List(Guid companyId)
    {
        var entries = await _db.JournalEntries.AsNoTracking()
            .Include(e => e.Lines)
            .Where(e => e.CompanyId == companyId)
            .OrderByDescending(e => e.Date)
            .ToListAsync();

        return Ok(entries.Select(ToResponse).ToList());
    }

    // B11: any journal entry, exported for the paper record — account code/name and partner name
    // resolved here rather than reusing JournalEntryResponse's raw account/partner ids, since a
    // spreadsheet meant to be read on paper needs the readable identifiers, not Guids.
    [Produces(ExcelExportService.XlsxContentType)]
    [HttpGet("{id:guid}/export", Name = "JournalEntryExport")]
    [RequireCompanyAccess(module: AccessModule.Accounting)]
    public async Task<IActionResult> Export(Guid companyId, Guid id)
    {
        var entry = await _db.JournalEntries.AsNoTracking()
            .Include(e => e.Lines)
            .FirstOrDefaultAsync(e => e.Id == id && e.CompanyId == companyId);
        if (entry is null)
        {
            return NotFound();
        }

        var accountIds = entry.Lines.Select(l => l.AccountId).ToHashSet();
        var accountsById = await _db.Accounts.AsNoTracking().Where(a => accountIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id);
        var partnerIds = entry.Lines.Where(l => l.PartnerId != null).Select(l => l.PartnerId!.Value).ToHashSet();
        var partnersById = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);

        var rows = entry.Lines.Select(l =>
        {
            accountsById.TryGetValue(l.AccountId, out var account);
            var partnerName = l.PartnerId is { } pid && partnersById.TryGetValue(pid, out var partner) ? partner.Name : null;
            return (IReadOnlyList<object?>)new object?[]
            {
                account?.Code, account?.Name, partnerName, l.Debit, l.Credit, l.Description
            };
        }).ToList();

        var headers = new[] { _labels["Common_AccountCode"], _labels["Common_AccountName"], _labels["Common_Partner"], _labels["Common_Debit"], _labels["Common_Credit"], _labels["Common_Description"] };
        var bytes = ExcelExportService.BuildWorkbook(entry.Reference ?? entry.Id.ToString(), headers, rows);
        var fileName = $"journal-entry-{entry.SequenceNumber ?? entry.Id.ToString()}.xlsx";
        return File(bytes, ExcelExportService.XlsxContentType, fileName);
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Accounting)]
    [ProducesResponseType(typeof(JournalEntryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<JournalEntryResponse>> Create(
        Guid companyId,
        CreateJournalEntryRequest request,
        [FromServices] ActionTokenService actionTokenService,
        [FromHeader(Name = "X-Action-Token")] string? actionToken = null)
    {
        if (string.IsNullOrWhiteSpace(actionToken))
        {
            return StatusCode(StatusCodes.Status403Forbidden, _localizer["ActionTokenRequired"].Value);
        }
        if (!actionTokenService.ValidateAndConsume(actionToken, CurrentUserId, companyId, "create-journal-entry"))
        {
            return StatusCode(StatusCodes.Status403Forbidden, _localizer["ActionTokenInvalid"].Value);
        }

        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.Id == request.JournalId);
        if (journal is null || journal.CompanyId != companyId)
        {
            return BadRequest(_localizer["InvalidJournal"].Value);
        }

        if (request.Lines.Any(l => Math.Abs(l.Debit) > MaxLineAmount || Math.Abs(l.Credit) > MaxLineAmount))
        {
            return BadRequest(string.Format(_localizer["LineAmountExceedsMax"], MaxLineAmount.ToString("N2")));
        }

        var accountIds = request.Lines.Select(l => l.AccountId).Distinct().ToList();
        var accountsById = await _db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id) && a.CompanyId == companyId)
            .ToDictionaryAsync(a => a.Id);
        if (accountsById.Count != accountIds.Count)
        {
            return BadRequest(_localizer["AccountsNotBelongToCompany"].Value);
        }

        // 60_Posting_Rules R02/R04/R05 (BLOCK) — only for this generic manual-entry path;
        // Invoice/Bill/PayrollRun legitimately post to control accounts as their whole purpose,
        // so these checks don't apply to their own Post() methods.
        //
        // R03 (Partner subledger) is NOT enforced here: R04 already blocks manual posting to
        // control accounts (the only accounts where a partner is truly mandatory), and non-control
        // accounts with SubledgerType.Partner (revenue, expense, etc.) use the subledger tag as
        // informational metadata for reports — not a hard requirement on manual journal entries.
        // An accountant must be able to post adjusting/reclassification entries to these accounts
        // without selecting a partner.
        // docs/INVENTORY_PLAN.md §5.3: while items are stock-tracked, their stock accounts are moved
        // only by stock documents, bills and invoices — a manual entry would put the ledger out of step
        // with the stock ledger (the QuickBooks complaint). Correct stock with a count or write-off.
        var stockAccountIds = await new StockService(_db, _localizer).StockAccountIdsInUseAsync(companyId);
        var stockLine = request.Lines.FirstOrDefault(l => stockAccountIds.Contains(l.AccountId));
        if (stockLine is not null)
        {
            return BadRequest(string.Format(_localizer["StockAccountManualEntry"].Value, accountsById[stockLine.AccountId].Code));
        }

        foreach (var line in request.Lines)
        {
            var account = accountsById[line.AccountId];
            try
            {
                PostingRuleValidator.ValidateManualLineAccountEligibility(account.Code, account.IsPostable, account.IsControl);
            }
            catch (Exception ex) when (
                ex is NonPostableAccountException or
                ControlAccountManualPostingException or
                SystemComputedAccountPostingException)
            {
                return BadRequest(ex.Message);
            }
        }

        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JournalId = request.JournalId,
            Date = request.Date,
            Reference = request.Reference,
            Remarks = request.Remarks,
            Lines = request.Lines.Select(l => new JournalEntryLine
            {
                Id = Guid.NewGuid(),
                AccountId = l.AccountId,
                PartnerId = l.PartnerId,
                Debit = l.Debit,
                Credit = l.Credit,
                Description = l.Description,
                AnalyticDistribution = l.AnalyticDistribution,
                ProjectId = l.ProjectId,
                EmployeeId = l.EmployeeId
            }).ToList()
        };

        _db.JournalEntries.Add(entry);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(entry));
    }

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(module: AccessModule.Accounting, approve: true)]
    public async Task<ActionResult<JournalEntryResponse>> Post(Guid companyId, Guid id)
    {
        // R23: finish JournalEntry.SequenceNumber the same way Invoice numbering already does —
        // a row lock on the Journal being posted into, serializing concurrent posts to the same
        // journal instead of racing on the counter (Postgres only, same SupportsRowLocking gate
        // as InvoicesController.Post).
        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (company is null)
            {
                return NotFound();
            }

            var entry = await _db.JournalEntries.Include(e => e.Lines)
                .FirstOrDefaultAsync(e => e.Id == id && e.CompanyId == companyId);
            if (entry is null)
            {
                return NotFound();
            }

            if (transaction is not null)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM journals WHERE \"Id\" = {entry.JournalId} FOR UPDATE");
            }

            var journal = await _db.Journals.FirstOrDefaultAsync(j => j.Id == entry.JournalId);
            if (journal is null)
            {
                return BadRequest(_localizer["JournalNoLongerExists"].Value);
            }

            // B4: the caller's own effective lock dates — company's own value unless CurrentUserId
            // holds a live exception for that field (AccountLockResolver never touches HardLockDate).
            var effectiveCompany = await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId);

            try
            {
                entry.Post(effectiveCompany);
            }
            catch (Exception ex) when (
                ex is UnbalancedJournalEntryException or
                NegativeAmountLineException or
                DualAmountLineException or
                AccountingLockDateViolationException or
                TaxLockDateViolationException or
                HardLockDateViolationException or
                InconsistentForeignCurrencyDataException or
                InvalidOperationException)
            {
                return BadRequest(ex.Message);
            }

            // Manual journal entries use NumberSeriesService (configurable format, derived
            // counter) instead of JournalSequencer's stored counter. This gives manual entries
            // the same configurable numbering (Format A: date-based, Format B: prefix-based)
            // as invoices, while invoice/bill/payroll-generated entries continue using
            // JournalSequencer for their per-journal accounting sequence.
            entry.SequenceNumber = await _numberSeries.ReserveNextAsync(companyId, "JournalEntry", entry.Date);
            entry.PostedByUserId = CurrentUserId;

            AuditController.Stage(_db, companyId, "JournalEntry", id.ToString(), "Post",
                CurrentUserId.ToString(), $"Seq={entry.SequenceNumber}");

            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            return Ok(ToResponse(entry));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    // R16 (storno): reverses a Posted journal entry with a mirror entry and marks the original
    // Cancelled. See JournalEntry.Reverse()'s own doc comment for why the reversal is created
    // already-Posted, not Draft.
    [HttpPost("{id:guid}/reverse")]
    [RequireCompanyAccess(module: AccessModule.Accounting, approve: true)]
    [ProducesResponseType(typeof(JournalEntryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<JournalEntryResponse>> Reverse(Guid companyId, Guid id, ReverseJournalEntryRequest request)
    {
        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            return NotFound();
        }

        var entry = await _db.JournalEntries.Include(e => e.Lines)
            .FirstOrDefaultAsync(e => e.Id == id && e.CompanyId == companyId);
        if (entry is null)
        {
            return NotFound();
        }

        var journal = await _db.Journals.FirstOrDefaultAsync(j => j.Id == entry.JournalId);
        if (journal is null)
        {
            return BadRequest(_localizer["JournalNoLongerExists"].Value);
        }

        var effectiveCompanyForReversal = await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId);

        JournalEntry reversal;
        try
        {
            reversal = entry.Reverse(effectiveCompanyForReversal, request.Date, request.Reference);
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            NegativeAmountLineException or
            DualAmountLineException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException or
            HardLockDateViolationException or
            InconsistentForeignCurrencyDataException)
        {
            return BadRequest(ex.Message);
        }

        reversal.PostedByUserId = CurrentUserId;
        reversal.SourceDocumentId = entry.Id;
        reversal.SequenceNumber = await _numberSeries.ReserveNextAsync(companyId, "JournalEntry", reversal.Date);

        _db.JournalEntries.Add(reversal);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(reversal));
    }

    private static JournalEntryResponse ToResponse(JournalEntry e) => new(
        e.Id,
        e.JournalId,
        e.Date,
        e.Reference,
        e.Remarks,
        e.State.ToString(),
        e.SequenceNumber,
        e.PostedAtUtc,
        e.Lines.Select(l => new JournalEntryLineResponse(l.Id, l.AccountId, l.PartnerId, l.Debit, l.Credit, l.Description, l.AnalyticDistribution, l.ProjectId, l.EmployeeId)).ToList());
}
