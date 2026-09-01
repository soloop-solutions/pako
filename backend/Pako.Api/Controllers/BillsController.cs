using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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

    public BillsController(PakoDbContext db, ITaxComputationService taxComputationService)
    {
        _db = db;
        _taxComputationService = taxComputationService;
    }

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

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(BillResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<BillResponse>> Create(Guid companyId, CreateBillRequest request)
    {
        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null || !partner.IsVendor)
        {
            return BadRequest("Invalid vendor partner for this company.");
        }

        if (request.Lines.Count == 0)
        {
            return BadRequest("Bill must have at least one line.");
        }

        var validAccountIds = (await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .Select(a => a.Id)
            .ToListAsync()).ToHashSet();

        var defaults = await GetAccountDefaultsAsync(companyId);
        if (defaults is null)
        {
            return BadRequest("Company has no account defaults seeded.");
        }

        var defaultExpenseAccountId = defaults.ExpenseAccountId;

        var lines = new List<BillLine>();
        var total = 0m;
        foreach (var line in request.Lines)
        {
            if (line.Quantity <= 0)
            {
                return BadRequest("Line quantity must be greater than zero.");
            }

            if (line.UnitPrice < 0)
            {
                return BadRequest("Line unit price cannot be negative.");
            }

            var discountPercent = line.DiscountPercent ?? 0m;
            if (discountPercent < 0 || discountPercent > 100)
            {
                return BadRequest("Line discount percent must be between 0 and 100.");
            }

            var expenseAccountId = line.ExpenseAccountId ?? defaultExpenseAccountId;
            if (!validAccountIds.Contains(expenseAccountId))
            {
                return BadRequest($"Expense account {expenseAccountId} does not belong to this company.");
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
            return BadRequest("Bills must have a positive total. To credit a vendor, create a credit note instead.");
        }

        if (request.OriginalBillId is { } originalBillId)
        {
            var originalExists = await _db.Bills.AsNoTracking()
                .AnyAsync(b => b.Id == originalBillId && b.CompanyId == companyId);
            if (!originalExists)
            {
                return BadRequest("originalBillId does not belong to this company.");
            }
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
            Lines = lines
        };

        _db.Bills.Add(bill);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(bill));
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
            return BadRequest("Amount must be positive.");
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
            return BadRequest("Bill must be Posted before a payment can be recorded against it.");
        }

        var cashOrBankAccount = await _db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.CashOrBankAccountId && a.CompanyId == companyId);
        if (cashOrBankAccount is null || (cashOrBankAccount.AccountSubType != AccountSubType.Cash && cashOrBankAccount.AccountSubType != AccountSubType.Bank))
        {
            return BadRequest("cashOrBankAccountId must be a Cash or Bank account for this company.");
        }

        var payableAccountId = await GetPayableAccountIdAsync(companyId);
        if (payableAccountId == Guid.Empty)
        {
            return BadRequest("Company has no Accounts Payable account seeded.");
        }

        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId);
        if (journal is null)
        {
            return BadRequest("Company has no journal to post into.");
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
            return BadRequest("Amount must be positive.");
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
            return BadRequest("creditNoteId must reference a Posted credit note for this company.");
        }

        var payableAccountId = await GetPayableAccountIdAsync(companyId);

        var creditNoteLineId = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntryId == creditNote.JournalEntryId && l.AccountId == payableAccountId)
            .Select(l => l.Id)
            .FirstOrDefaultAsync();
        if (creditNoteLineId == Guid.Empty)
        {
            return BadRequest("Credit note has no payable line to apply.");
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
        var isSourceDocument = documentType == DocumentType.CreditNote;

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

        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId);
        if (journal is null)
        {
            return BadRequest("Company has no journal to post into.");
        }

        var payableAccountId = await GetPayableAccountIdAsync(companyId);
        if (payableAccountId == Guid.Empty)
        {
            return BadRequest("Company has no Accounts Payable account seeded.");
        }

        var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
            .Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId)
            .ToDictionaryAsync(t => t.Id);

        JournalEntry journalEntry;
        try
        {
            journalEntry = bill.Post(company, journal.Id, payableAccountId, _taxComputationService, taxDefinitionsById);
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException)
        {
            return BadRequest(ex.Message);
        }

        _db.JournalEntries.Add(journalEntry);
        await _db.SaveChangesAsync();

        return Ok(ToResponse(bill));
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
        b.Lines.Select(l => new BillLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.ExpenseAccountId, l.DiscountPercent)).ToList());
}
