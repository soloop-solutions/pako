using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;
using Pako.Domain.Tax;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/invoices")]
[Authorize]
public class InvoicesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly ITaxComputationService _taxComputationService;

    public InvoicesController(PakoDbContext db, ITaxComputationService taxComputationService)
    {
        _db = db;
        _taxComputationService = taxComputationService;
    }

    [HttpGet]
    [RequireCompanyAccess]
    public async Task<ActionResult<List<InvoiceResponse>>> List(Guid companyId)
    {
        var invoices = await _db.Invoices.AsNoTracking()
            .Include(i => i.Lines)
            .Where(i => i.CompanyId == companyId)
            .OrderByDescending(i => i.IssueDate)
            .ToListAsync();

        return Ok(invoices.Select(ToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    [RequireCompanyAccess]
    public async Task<ActionResult<InvoiceResponse>> Get(Guid companyId, Guid id)
    {
        var invoice = await _db.Invoices.AsNoTracking()
            .Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);

        if (invoice is null)
        {
            return NotFound();
        }

        return Ok(ToResponse(invoice));
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(InvoiceResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<InvoiceResponse>> Create(Guid companyId, CreateInvoiceRequest request)
    {
        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null || !partner.IsCustomer)
        {
            return BadRequest("Invalid customer partner for this company.");
        }

        if (request.Lines.Count == 0)
        {
            return BadRequest("Invoice must have at least one line.");
        }

        var accountsByCode = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .ToDictionaryAsync(a => a.Code, a => a.Id);
        var validAccountIds = accountsByCode.Values.ToHashSet();

        if (!accountsByCode.TryGetValue(DefaultChartOfAccountsTemplate.DefaultRevenueAccountCode, out var defaultRevenueAccountId))
        {
            return BadRequest("Company has no default revenue account seeded.");
        }

        var lines = new List<InvoiceLine>();
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

            var revenueAccountId = line.RevenueAccountId ?? defaultRevenueAccountId;
            if (!validAccountIds.Contains(revenueAccountId))
            {
                return BadRequest($"Revenue account {revenueAccountId} does not belong to this company.");
            }

            total += line.Quantity * line.UnitPrice;

            lines.Add(new InvoiceLine
            {
                Id = Guid.NewGuid(),
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                TaxDefinitionId = line.TaxDefinitionId,
                RevenueAccountId = revenueAccountId
            });
        }

        if (total <= 0)
        {
            return BadRequest("Invoices must have a positive total. Credit notes are not yet supported.");
        }

        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            PartnerId = request.PartnerId,
            IssueDate = request.IssueDate,
            DueDate = request.DueDate,
            Lines = lines
        };

        _db.Invoices.Add(invoice);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(invoice));
    }

    [HttpGet("{id:guid}/balance")]
    [RequireCompanyAccess]
    public async Task<ActionResult<DocumentBalanceResponse>> Balance(Guid companyId, Guid id)
    {
        var invoice = await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        return Ok(await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId));
    }

    // Atomic replacement for the client's old draft-journal-entry -> post -> reconcile 3-call
    // sequence: builds the settlement entry, posts it, and reconciles it against this invoice in
    // one transaction (Postgres only — see SupportsRowLocking), so a mid-sequence failure (e.g. an
    // invalid cashOrBankAccountId, or the reconciliation itself failing Fix 1's line-capacity
    // check) leaves nothing persisted instead of an orphaned Posted journal entry.
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

        var invoice = await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        if (invoice.State != InvoiceState.Posted)
        {
            return BadRequest("Invoice must be Posted before a payment can be recorded against it.");
        }

        var cashOrBankAccount = await _db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.CashOrBankAccountId && a.CompanyId == companyId);
        if (cashOrBankAccount is null || (cashOrBankAccount.AccountSubType != AccountSubType.Cash && cashOrBankAccount.AccountSubType != AccountSubType.Bank))
        {
            return BadRequest("cashOrBankAccountId must be a Cash or Bank account for this company.");
        }

        var receivableAccountId = await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.Code == DefaultChartOfAccountsTemplate.AccountsReceivableCode)
            .Select(a => a.Id)
            .FirstOrDefaultAsync();
        if (receivableAccountId == Guid.Empty)
        {
            return BadRequest("Company has no Accounts Receivable account seeded.");
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
                Reference = $"Payment for {invoice.InvoiceNumber}",
                Lines =
                {
                    new JournalEntryLine { Id = Guid.NewGuid(), AccountId = cashOrBankAccount.Id, Debit = request.Amount, Credit = 0m },
                    new JournalEntryLine { Id = Guid.NewGuid(), AccountId = receivableAccountId, PartnerId = invoice.PartnerId, Debit = 0m, Credit = request.Amount }
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

            var settlementLineId = settlementEntry.Lines.Single(l => l.AccountId == receivableAccountId).Id;
            var result = await ReconciliationCreator.TryCreateAsync(_db, companyId, id, null, settlementLineId, request.Amount);
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

            var balance = await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId);
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

    private async Task<DocumentBalanceResponse> ComputeBalanceAsync(Guid companyId, Guid invoiceId, Guid? journalEntryId)
    {
        var total = 0m;
        if (journalEntryId is { } jeId)
        {
            var receivableAccountId = await _db.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.Code == DefaultChartOfAccountsTemplate.AccountsReceivableCode)
                .Select(a => a.Id)
                .FirstOrDefaultAsync();
            total = await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntryId == jeId && l.AccountId == receivableAccountId)
                .SumAsync(l => l.Debit);
        }

        var reconciled = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId == invoiceId)
            .SumAsync(r => r.Amount);

        return new DocumentBalanceResponse(total, reconciled, total - reconciled);
    }

    private static ReconciliationResponse ToReconciliationResponse(Reconciliation r) =>
        new(r.Id, r.InvoiceId, r.BillId, r.JournalEntryLineId, r.Amount, r.ReconciledAt);

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(writeAccess: true)]
    public async Task<ActionResult<InvoiceResponse>> Post(Guid companyId, Guid id)
    {
        // Company.NextInvoiceNumber is reserved via a read-increment-write on the Company row
        // (Invoice.Post -> Company.ReserveNextInvoiceNumber). Concurrent posts for the same
        // company would otherwise race on that counter and collide on the unique
        // (CompanyId, InvoiceNumber) index. Taking a row lock on the Company row up front
        // (Postgres only — the InMemory test provider doesn't support it and doesn't need it)
        // serializes concurrent posts for the same company instead of letting them race.
        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            if (transaction is not null)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
            }

            var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (company is null)
            {
                return NotFound();
            }

            var invoice = await _db.Invoices.Include(i => i.Lines)
                .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
            if (invoice is null)
            {
                return NotFound();
            }

            var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId);
            if (journal is null)
            {
                return BadRequest("Company has no journal to post into.");
            }

            var receivableAccountId = await _db.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.Code == DefaultChartOfAccountsTemplate.AccountsReceivableCode)
                .Select(a => a.Id)
                .FirstOrDefaultAsync();
            if (receivableAccountId == Guid.Empty)
            {
                return BadRequest("Company has no Accounts Receivable account seeded.");
            }

            var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
                .Include(t => t.RepartitionLines)
                .Where(t => t.CompanyId == companyId)
                .ToDictionaryAsync(t => t.Id);

            JournalEntry journalEntry;
            try
            {
                journalEntry = invoice.Post(company, journal.Id, receivableAccountId, _taxComputationService, taxDefinitionsById);
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

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            return Ok(ToResponse(invoice));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private static InvoiceResponse ToResponse(Invoice i) => new(
        i.Id,
        i.PartnerId,
        i.InvoiceNumber,
        i.IssueDate,
        i.DueDate,
        i.State.ToString(),
        i.JournalEntryId,
        i.Lines.Select(l => new InvoiceLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.RevenueAccountId)).ToList());
}
