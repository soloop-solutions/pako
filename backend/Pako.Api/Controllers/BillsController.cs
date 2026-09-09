using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/bills")]
[Authorize]
public class BillsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly ITaxComputationService _taxComputationService;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public BillsController(PakoDbContext db, ITaxComputationService taxComputationService, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _taxComputationService = taxComputationService;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<BillResponse>>> List(Guid companyId)
    {
        var bills = await _db.Bills.AsNoTracking()
            .Include(b => b.Lines)
            .Where(b => b.CompanyId == companyId)
            .OrderByDescending(b => b.IssueDate)
            .ToListAsync();

        return Ok(bills.Select(ToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<BillResponse>> Get(Guid companyId, Guid id)
    {
        var bill = await _db.Bills.AsNoTracking()
            .Include(b => b.Lines)
            .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);

        if (bill is null)
        {
            return NotFound();
        }

        return Ok(ToResponse(bill));
    }

    // A4 (v2 release): mirror of InvoicesController.Discard — no DELETE route exists on this
    // controller either; a genuinely blank Draft (never posted, no journal entry) may be
    // discarded via this dedicated POST action instead. Bill has no numbering field to check
    // (VendorReference is free vendor-supplied text, not PAKO-minted), so the guard is just
    // State/JournalEntryId, unlike Invoice's three-field check.
    [HttpPost("{id:guid}/discard")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<IActionResult> Discard(Guid companyId, Guid id)
    {
        var bill = await _db.Bills.FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        if (bill.State != BillState.Draft || bill.JournalEntryId is not null)
        {
            return BadRequest(_localizer["BillNotDraftForDiscard"].Value);
        }

        _db.Bills.Remove(bill);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    // A5 (v2 release): extracted from Create() so Update()'s Draft-full-replace path can reuse
    // the identical validation — pure extraction, no behavior change. Mirror of
    // InvoicesController.BuildAndValidateLinesAsync.
    private async Task<(List<BillLine>? Lines, decimal Total, ActionResult? Error)> BuildAndValidateLinesAsync(
        Guid companyId, List<CreateBillLineRequest> requestLines)
    {
        if (requestLines.Count == 0)
        {
            return (null, 0m, BadRequest(_localizer["BillMustHaveLines"].Value));
        }

        var validAccountIds = (await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .Select(a => a.Id)
            .ToListAsync()).ToHashSet();

        var defaults = await GetAccountDefaultsAsync(companyId);
        if (defaults is null)
        {
            return (null, 0m, BadRequest(_localizer["NoAccountDefaults"].Value));
        }

        var defaultExpenseAccountId = defaults.ExpenseAccountId;

        var lines = new List<BillLine>();
        var total = 0m;
        foreach (var line in requestLines)
        {
            if (line.Quantity <= 0)
            {
                return (null, 0m, BadRequest(_localizer["LineQuantityMustBePositive"].Value));
            }

            if (line.UnitPrice < 0)
            {
                return (null, 0m, BadRequest(_localizer["LineUnitPriceNonNegative"].Value));
            }

            var discountPercent = line.DiscountPercent ?? 0m;
            if (discountPercent < 0 || discountPercent > 100)
            {
                return (null, 0m, BadRequest(_localizer["LineDiscountOutOfRange"].Value));
            }

            var expenseAccountId = line.ExpenseAccountId ?? defaultExpenseAccountId;
            if (!validAccountIds.Contains(expenseAccountId))
            {
                return (null, 0m, BadRequest(string.Format(_localizer["ExpenseAccountNotBelongToCompany"], expenseAccountId)));
            }

            total += line.Quantity * line.UnitPrice * (1 - discountPercent / 100m);

            lines.Add(new BillLine
            {
                Id = Guid.NewGuid(),
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                DiscountPercent = discountPercent,
                TaxDefinitionId = line.TaxDefinitionId,
                ExpenseAccountId = expenseAccountId
            });
        }

        if (total <= 0)
        {
            return (null, 0m, BadRequest(_localizer["BillMustBePositiveTotal"].Value));
        }

        return (lines, total, null);
    }

    // Track A (v2 release): mirror of InvoicesController.ValidateOriginalInvoiceAsync.
    private async Task<ActionResult?> ValidateOriginalBillAsync(Guid companyId, DocumentType documentType, Guid? originalBillId)
    {
        if (documentType == DocumentType.PurchaseReturn && originalBillId is null)
        {
            return BadRequest(_localizer["OriginalBillRequiredForPurchaseReturn"].Value);
        }

        if (originalBillId is { } id)
        {
            var originalExists = await _db.Bills.AsNoTracking()
                .AnyAsync(b => b.Id == id && b.CompanyId == companyId);
            if (!originalExists)
            {
                return BadRequest(_localizer["OriginalBillNotBelongToCompany"].Value);
            }
        }

        return null;
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(BillResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<BillResponse>> Create(Guid companyId, CreateBillRequest request)
    {
        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null || !partner.IsVendor)
        {
            return BadRequest(_localizer["InvalidVendorPartner"].Value);
        }

        var (lines, _, linesError) = await BuildAndValidateLinesAsync(companyId, request.Lines);
        if (linesError is not null)
        {
            return linesError;
        }

        var originalBillError = await ValidateOriginalBillAsync(companyId, request.DocumentType, request.OriginalBillId);
        if (originalBillError is not null)
        {
            return originalBillError;
        }

        var bill = new Bill
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            PartnerId = request.PartnerId,
            VendorReference = request.VendorReference,
            IssueDate = request.IssueDate,
            DueDate = request.DueDate,
            DocumentType = request.DocumentType,
            OriginalBillId = request.OriginalBillId,
            Lines = lines!
        };

        _db.Bills.Add(bill);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(bill));
    }

    // A5 (v2 release): mirror of InvoicesController.Update.
    [HttpPut("{id:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<BillResponse>> Update(Guid companyId, Guid id, UpdateBillRequest request)
    {
        var bill = await _db.Bills.Include(b => b.Lines)
            .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        if (bill.State == BillState.Cancelled)
        {
            return BadRequest(_localizer["BillNotEditableWhenCancelled"].Value);
        }

        if (bill.State == BillState.Posted)
        {
            return BadRequest(_localizer["BillOnlyDueDateOrNotesEditableAfterPosting"].Value);
        }

        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null || !partner.IsVendor)
        {
            return BadRequest(_localizer["InvalidVendorPartner"].Value);
        }

        var (lines, _, linesError) = await BuildAndValidateLinesAsync(companyId, request.Lines);
        if (linesError is not null)
        {
            return linesError;
        }

        var originalBillError = await ValidateOriginalBillAsync(companyId, request.DocumentType, request.OriginalBillId);
        if (originalBillError is not null)
        {
            return originalBillError;
        }

        // See InvoicesController.Update's identical comment — managed directly via the BillLines
        // DbSet rather than through collection-navigation fixup, which hit a
        // DbUpdateConcurrencyException on the InMemory provider.
        _db.BillLines.RemoveRange(bill.Lines);
        foreach (var line in lines!)
        {
            line.BillId = bill.Id;
        }
        _db.BillLines.AddRange(lines);

        bill.PartnerId = request.PartnerId;
        bill.VendorReference = request.VendorReference;
        bill.IssueDate = request.IssueDate;
        bill.DueDate = request.DueDate;
        bill.DocumentType = request.DocumentType;
        bill.OriginalBillId = request.OriginalBillId;
        bill.InternalNotes = request.InternalNotes;

        await _db.SaveChangesAsync();

        bill.Lines = lines;
        return Ok(ToResponse(bill));
    }

    // A5 (v2 release): mirror of InvoicesController.EditPosted.
    [HttpPatch("{id:guid}")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<BillResponse>> EditPosted(Guid companyId, Guid id, EditPostedBillRequest request)
    {
        var bill = await _db.Bills.Include(b => b.Lines)
            .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        if (bill.State != BillState.Posted)
        {
            return BadRequest(_localizer["BillOnlyDueDateOrNotesEditableAfterPosting"].Value);
        }

        var dueDateChanged = bill.DueDate != request.DueDate;
        var notesChanged = bill.InternalNotes != request.InternalNotes;

        if (dueDateChanged || notesChanged)
        {
            _db.DocumentEditAudits.Add(new Pako.Domain.Invoicing.DocumentEditAudit
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                DocumentId = bill.Id,
                UserId = CurrentUserId,
                OldDueDate = dueDateChanged ? bill.DueDate : null,
                NewDueDate = dueDateChanged ? request.DueDate : null,
                OldInternalNotes = notesChanged ? bill.InternalNotes : null,
                NewInternalNotes = notesChanged ? request.InternalNotes : null
            });

            bill.DueDate = request.DueDate;
            bill.InternalNotes = request.InternalNotes;

            await _db.SaveChangesAsync();
        }

        return Ok(ToResponse(bill));
    }

    [HttpGet("{id:guid}/balance")]
    [RequireCompanyAccess]
    public async Task<ActionResult<DocumentBalanceResponse>> Balance(Guid companyId, Guid id)
    {
        var bill = await _db.Bills.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        return Ok(await ComputeBalanceAsync(companyId, id, bill.JournalEntryId, bill.DocumentType));
    }

    // Atomic replacement for the client's old draft-journal-entry -> post -> reconcile 3-call
    // sequence — see InvoicesController.RecordPayment's comment; this is the AP mirror (Debit
    // AP / Credit Cash-or-Bank instead of Debit Cash-or-Bank / Credit AR).
    [HttpPost("{id:guid}/record-payment")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(RecordPaymentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<RecordPaymentResponse>> RecordPayment(Guid companyId, Guid id, RecordPaymentRequest request)
    {
        if (request.Amount <= 0)
        {
            return BadRequest(_localizer["AmountMustBePositive"].Value);
        }

        var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            return NotFound();
        }

        var bill = await _db.Bills.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        if (bill.State != BillState.Posted)
        {
            return BadRequest(_localizer["BillMustBePostedForPayment"].Value);
        }

        var cashOrBankAccount = await _db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.CashOrBankAccountId && a.CompanyId == companyId);
        if (cashOrBankAccount is null || (cashOrBankAccount.AccountSubType != AccountSubType.Cash && cashOrBankAccount.AccountSubType != AccountSubType.Bank))
        {
            return BadRequest(_localizer["InvalidCashOrBankAccount"].Value);
        }

        var payableAccountId = await GetPayableAccountIdAsync(companyId);
        if (payableAccountId == Guid.Empty)
        {
            return BadRequest(_localizer["NoPayableAccount"].Value);
        }

        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId);
        if (journal is null)
        {
            return BadRequest(_localizer["NoJournalToPost"].Value);
        }

        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            var settlementEntry = new JournalEntry
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                JournalId = journal.Id,
                Date = request.Date,
                Reference = $"Payment for {bill.VendorReference}",
                Lines =
                {
                    new JournalEntryLine { Id = Guid.NewGuid(), AccountId = payableAccountId, PartnerId = bill.PartnerId, Debit = request.Amount, Credit = 0m },
                    new JournalEntryLine { Id = Guid.NewGuid(), AccountId = cashOrBankAccount.Id, Debit = 0m, Credit = request.Amount }
                }
            };

            try
            {
                settlementEntry.Post(company);
            }
            catch (Exception ex) when (
                ex is InvalidOperationException or
                UnbalancedJournalEntryException or
                AccountingLockDateViolationException or
                TaxLockDateViolationException)
            {
                return BadRequest(ex.Message);
            }

            _db.JournalEntries.Add(settlementEntry);
            await _db.SaveChangesAsync();

            var settlementLineId = settlementEntry.Lines.Single(l => l.AccountId == payableAccountId).Id;
            var result = await ReconciliationCreator.TryCreateAsync(_db, companyId, null, id, settlementLineId, request.Amount);
            if (result.Status == ReconciliationCreationStatus.NotFound)
            {
                return NotFound();
            }

            if (result.Status == ReconciliationCreationStatus.ValidationFailed)
            {
                return BadRequest(result.Error);
            }

            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            var balance = await ComputeBalanceAsync(companyId, id, bill.JournalEntryId, bill.DocumentType);
            return StatusCode(StatusCodes.Status201Created, new RecordPaymentResponse(ToReconciliationResponse(result.Reconciliation!), balance));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    // AP mirror of InvoicesController.ApplyCreditNote — feeds the vendor credit note's own AP
    // line to ReconciliationCreator as the settlement line.
    [HttpPost("{id:guid}/apply-credit-note")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(ApplyCreditNoteResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ApplyCreditNoteResponse>> ApplyCreditNote(Guid companyId, Guid id, ApplyCreditNoteRequest request)
    {
        if (request.Amount <= 0)
        {
            return BadRequest(_localizer["AmountMustBePositive"].Value);
        }

        var bill = await _db.Bills.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        var creditNote = await _db.Bills.AsNoTracking()
            .FirstOrDefaultAsync(b => b.Id == request.CreditNoteId && b.CompanyId == companyId);
        if (creditNote is null)
        {
            return NotFound();
        }

        if (creditNote.DocumentType != DocumentType.CreditNote || creditNote.State != BillState.Posted)
        {
            return BadRequest(_localizer["InvalidCreditNote"].Value);
        }

        var payableAccountId = await GetPayableAccountIdAsync(companyId);

        var creditNoteLineId = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntryId == creditNote.JournalEntryId && l.AccountId == payableAccountId)
            .Select(l => l.Id)
            .FirstOrDefaultAsync();
        if (creditNoteLineId == Guid.Empty)
        {
            return BadRequest(_localizer["CreditNoteNoPayableLine"].Value);
        }

        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            if (transaction is not null)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM journal_entry_lines WHERE \"Id\" = {creditNoteLineId} FOR UPDATE");
            }

            var result = await ReconciliationCreator.TryCreateAsync(_db, companyId, null, id, creditNoteLineId, request.Amount);
            if (result.Status == ReconciliationCreationStatus.NotFound)
            {
                return NotFound();
            }

            if (result.Status == ReconciliationCreationStatus.ValidationFailed)
            {
                return BadRequest(result.Error);
            }

            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            var balance = await ComputeBalanceAsync(companyId, id, bill.JournalEntryId, bill.DocumentType);
            return StatusCode(StatusCodes.Status201Created, new ApplyCreditNoteResponse(ToReconciliationResponse(result.Reconciliation!), balance));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private async Task<DocumentBalanceResponse> ComputeBalanceAsync(Guid companyId, Guid billId, Guid? journalEntryId, DocumentType documentType)
    {
        // A2 (v2 release): PurchaseReturn posts through the same isCreditNote mechanics as
        // CreditNote — its own AP control line is Debit-sided too, so it needs no separate
        // ternary the way Invoicing's CreditNote-vs-DownPayment split does.
        var isSourceDocument = documentType is DocumentType.CreditNote or DocumentType.PurchaseReturn;

        var total = 0m;
        Guid? controlLineId = null;
        if (journalEntryId is { } jeId)
        {
            var payableAccountId = await GetPayableAccountIdAsync(companyId);

            if (isSourceDocument)
            {
                var controlLine = await _db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == jeId && l.AccountId == payableAccountId)
                    .Select(l => new { l.Id, l.Debit })
                    .FirstOrDefaultAsync();
                if (controlLine is not null)
                {
                    controlLineId = controlLine.Id;
                    total = controlLine.Debit;
                }
            }
            else
            {
                total = await _db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == jeId && l.AccountId == payableAccountId)
                    .SumAsync(l => l.Credit);
            }
        }

        var reconciled = isSourceDocument
            ? controlLineId is { } lineId ? await ReconciliationCreator.SumReconciledForLineAsync(_db, lineId) : 0m
            : await _db.Reconciliations.AsNoTracking().Where(r => r.BillId == billId).SumAsync(r => r.Amount);

        return new DocumentBalanceResponse(total, reconciled, total - reconciled);
    }

    private static ReconciliationResponse ToReconciliationResponse(Reconciliation r) =>
        new(r.Id, r.InvoiceId, r.BillId, r.JournalEntryLineId, r.Amount, r.ReconciledAt);

    private Task<CompanyAccountDefaults?> GetAccountDefaultsAsync(Guid companyId) =>
        _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);

    private async Task<Guid> GetPayableAccountIdAsync(Guid companyId) =>
        (await GetAccountDefaultsAsync(companyId))?.PayableAccountId ?? Guid.Empty;

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<BillResponse>> Post(Guid companyId, Guid id)
    {
        // Track A (v2 release): Bill never had a numbering counter to protect (VendorReference is
        // free text), so this method had no transaction before now. A PurchaseReturn needs one to
        // serialize the exceeds-check below against concurrent partial returns on the same
        // original bill — row-locks the original bill's row, not the company row, since there's
        // nothing company-wide to protect on the Bill side (mirrors InvoicesController.Post's
        // company-row lock, scoped to what actually needs protecting here).
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

            var bill = await _db.Bills.Include(b => b.Lines)
                .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
            if (bill is null)
            {
                return NotFound();
            }

            var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == bill.PartnerId);

            var journal = await _db.Journals.FirstOrDefaultAsync(j => j.CompanyId == companyId);
            if (journal is null)
            {
                return BadRequest(_localizer["NoJournalToPost"].Value);
            }

            var defaults = await GetAccountDefaultsAsync(companyId);
            if (defaults is null || defaults.PayableAccountId == Guid.Empty)
            {
                return BadRequest(_localizer["NoPayableAccount"].Value);
            }

            var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
                .Include(t => t.RepartitionLines)
                .Where(t => t.CompanyId == companyId)
                .ToDictionaryAsync(t => t.Id);

            // 60_Posting_Rules R07/R08/R09 (BLOCK) — see InvoicesController.Post's identical comment.
            var lineAccountsById = await _db.Accounts.AsNoTracking()
                .Where(a => bill.Lines.Select(l => l.ExpenseAccountId).Contains(a.Id))
                .ToDictionaryAsync(a => a.Id);
            foreach (var line in bill.Lines)
            {
                if (line.TaxDefinitionId is not { } taxDefId || !taxDefinitionsById.TryGetValue(taxDefId, out var taxDef) || taxDef.Code is null)
                {
                    continue;
                }

                var account = lineAccountsById[line.ExpenseAccountId];
                try
                {
                    PostingRuleValidator.ValidateVatCounterpartyTaxNumber(taxDef.Code, bill.PartnerId, partner?.TaxNumber);
                    if (taxDef.Direction is { } direction && account.Class is { } accountClass)
                    {
                        PostingRuleValidator.ValidateVatDirectionAgainstAccountClass(taxDef.Code, direction, accountClass);
                    }
                    PostingRuleValidator.ValidateVatNotAppliedToControlAccount(taxDef.Code, account.Code);
                }
                catch (Exception ex) when (
                    ex is MissingCounterpartyTaxNumberException or
                    VatDirectionAccountClassMismatchException or
                    VatOnControlAccountException)
                {
                    return BadRequest(ex.Message);
                }
            }

            JournalEntry journalEntry;
            try
            {
                journalEntry = bill.Post(
                    company, journal.Id, defaults.PayableAccountId, _taxComputationService, taxDefinitionsById,
                    defaults.ReverseChargeInputVatAccountId, defaults.ReverseChargeOutputVatAccountId);
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

            // A2 (v2 release): mirror of InvoicesController.Post's identical SalesReturn check —
            // goods returned to a supplier must not exceed what the original bill still has
            // un-returned. Checked after bill.Post() succeeded, before SaveChangesAsync.
            if (bill.DocumentType == DocumentType.PurchaseReturn)
            {
                if (bill.OriginalBillId is not { } originalBillId)
                {
                    return BadRequest(_localizer["OriginalBillRequiredForPurchaseReturn"].Value);
                }

                if (transaction is not null)
                {
                    await _db.Database.ExecuteSqlInterpolatedAsync(
                        $"SELECT \"Id\" FROM bills WHERE \"Id\" = {originalBillId} FOR UPDATE");
                }

                var original = await _db.Bills.AsNoTracking()
                    .FirstOrDefaultAsync(b => b.Id == originalBillId && b.CompanyId == companyId);
                if (original is null || original.State != BillState.Posted)
                {
                    return BadRequest(_localizer["OriginalBillMustBePostedForReturn"].Value);
                }

                var originalTotal = original.JournalEntryId is { } originalJournalEntryId
                    ? await _db.JournalEntryLines.AsNoTracking()
                        .Where(l => l.JournalEntryId == originalJournalEntryId && l.AccountId == defaults.PayableAccountId)
                        .SumAsync(l => l.Credit)
                    : 0m;

                var otherReturnJournalEntryIds = await _db.Bills.AsNoTracking()
                    .Where(b => b.CompanyId == companyId && b.OriginalBillId == originalBillId &&
                        b.DocumentType == DocumentType.PurchaseReturn && b.State == BillState.Posted && b.Id != bill.Id)
                    .Select(b => b.JournalEntryId)
                    .ToListAsync();
                var alreadyReturned = otherReturnJournalEntryIds.Count == 0
                    ? 0m
                    : await _db.JournalEntryLines.AsNoTracking()
                        .Where(l => otherReturnJournalEntryIds.Contains(l.JournalEntryId) && l.AccountId == defaults.PayableAccountId)
                        .SumAsync(l => l.Debit);

                var thisReturnAmount = journalEntry.Lines.Single(l => l.AccountId == defaults.PayableAccountId).Debit;

                if (alreadyReturned + thisReturnAmount > originalTotal)
                {
                    var remaining = originalTotal - alreadyReturned;
                    return BadRequest(string.Format(_localizer["PurchaseReturnExceedsRemainingOriginalAmount"], thisReturnAmount, remaining));
                }
            }

            journalEntry.PostedByUserId = CurrentUserId;
            journalEntry.SourceDocumentId = bill.Id;
            journalEntry.SequenceNumber = JournalSequencer.ReserveNext(journal);

            _db.JournalEntries.Add(journalEntry);
            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            return Ok(ToResponse(bill));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private static BillResponse ToResponse(Bill b) => new(
        b.Id,
        b.PartnerId,
        b.VendorReference,
        b.IssueDate,
        b.DueDate,
        b.State.ToString(),
        b.DocumentType,
        b.OriginalBillId,
        b.JournalEntryId,
        b.Lines.Select(l => new BillLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.ExpenseAccountId, l.DiscountPercent)).ToList(),
        b.InternalNotes);
}
