using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Ledger;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/journal-entries")]
[Authorize]
public class JournalEntriesController : ControllerBase
{
    private const decimal MaxLineAmount = 9999999999999999.99m;

    private readonly PakoDbContext _db;

    public JournalEntriesController(PakoDbContext db)
    {
        _db = db;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<JournalEntryResponse>>> List(Guid companyId)
    {
        var entries = await _db.JournalEntries.AsNoTracking()
            .Include(e => e.Lines)
            .Where(e => e.CompanyId == companyId)
            .OrderByDescending(e => e.Date)
            .ToListAsync();

        return Ok(entries.Select(ToResponse).ToList());
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(JournalEntryResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<JournalEntryResponse>> Create(Guid companyId, CreateJournalEntryRequest request)
    {
        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.Id == request.JournalId);
        if (journal is null || journal.CompanyId != companyId)
        {
            return BadRequest("Invalid journal for this company.");
        }

        if (request.Lines.Any(l => Math.Abs(l.Debit) > MaxLineAmount || Math.Abs(l.Credit) > MaxLineAmount))
        {
            return BadRequest($"Line amounts cannot exceed {MaxLineAmount:N2}.");
        }

        var accountIds = request.Lines.Select(l => l.AccountId).Distinct().ToList();
        var accountsById = await _db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id) && a.CompanyId == companyId)
            .ToDictionaryAsync(a => a.Id);
        if (accountsById.Count != accountIds.Count)
        {
            return BadRequest("One or more accounts do not belong to this company.");
        }

        // 60_Posting_Rules R02/R03/R04/R05 (BLOCK) — only for this generic manual-entry path;
        // Invoice/Bill/PayrollRun legitimately post to control accounts as their whole purpose,
        // so these checks don't apply to their own Post() methods. R09 needs a per-line VAT
        // code, which CreateJournalEntryLineRequest has no field for at all — genuinely
        // unreachable here, not a gap in this check.
        foreach (var line in request.Lines)
        {
            var account = accountsById[line.AccountId];
            try
            {
                PostingRuleValidator.ValidateManualLineAccountEligibility(account.Code, account.IsPostable, account.IsControl);
                if (account.Subledger is { } subledger)
                {
                    PostingRuleValidator.ValidatePartnerSubledgerReference(account.Code, subledger, line.PartnerId);
                }
            }
            catch (Exception ex) when (
                ex is NonPostableAccountException or
                ControlAccountManualPostingException or
                SystemComputedAccountPostingException or
                MissingSubledgerReferenceException)
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
            Lines = request.Lines.Select(l => new JournalEntryLine
            {
                Id = Guid.NewGuid(),
                AccountId = l.AccountId,
                PartnerId = l.PartnerId,
                Debit = l.Debit,
                Credit = l.Credit,
                Description = l.Description
            }).ToList()
        };

        _db.JournalEntries.Add(entry);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(entry));
    }

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(writeAccess: true)]
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
                return BadRequest("Journal entry references a journal that no longer exists.");
            }

            try
            {
                entry.Post(company);
            }
            catch (Exception ex) when (
                ex is UnbalancedJournalEntryException or
                AccountingLockDateViolationException or
                TaxLockDateViolationException or
                InconsistentForeignCurrencyDataException or
                InvalidOperationException)
            {
                return BadRequest(ex.Message);
            }

            entry.SequenceNumber = JournalSequencer.ReserveNext(journal);
            entry.PostedByUserId = CurrentUserId;

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
    [RequireCompanyAccess(writeAccess: true)]
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
            return BadRequest("Journal entry references a journal that no longer exists.");
        }

        JournalEntry reversal;
        try
        {
            reversal = entry.Reverse(company, request.Date, request.Reference);
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException or
            InconsistentForeignCurrencyDataException)
        {
            return BadRequest(ex.Message);
        }

        reversal.PostedByUserId = CurrentUserId;
        reversal.SourceDocumentId = entry.Id;
        reversal.SequenceNumber = JournalSequencer.ReserveNext(journal);

        _db.JournalEntries.Add(reversal);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(reversal));
    }

    private static JournalEntryResponse ToResponse(JournalEntry e) => new(
        e.Id,
        e.JournalId,
        e.Date,
        e.Reference,
        e.State.ToString(),
        e.SequenceNumber,
        e.PostedAtUtc,
        e.Lines.Select(l => new JournalEntryLineResponse(l.Id, l.AccountId, l.PartnerId, l.Debit, l.Credit, l.Description)).ToList());
}
