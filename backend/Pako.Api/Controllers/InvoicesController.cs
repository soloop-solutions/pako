using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;
using Pako.Domain.Companies;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

[ApiController]
[Route("api/companies/{companyId:guid}/invoices")]
[Authorize]
public class InvoicesController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly ITaxComputationService _taxComputationService;
    private readonly IDocumentNumberService _documentNumberService;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public InvoicesController(
        PakoDbContext db,
        ITaxComputationService taxComputationService,
        IDocumentNumberService documentNumberService,
        IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _taxComputationService = taxComputationService;
        _documentNumberService = documentNumberService;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

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
            return BadRequest(_localizer["InvalidCustomerPartner"].Value);
        }

        if (request.Lines.Count == 0)
        {
            return BadRequest(_localizer["InvoiceMustHaveLines"].Value);
        }

        var validAccountIds = (await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId)
            .Select(a => a.Id)
            .ToListAsync()).ToHashSet();

        var defaults = await GetAccountDefaultsAsync(companyId);
        if (defaults is null)
        {
            return BadRequest(_localizer["NoAccountDefaults"].Value);
        }

        var defaultRevenueAccountId = defaults.RevenueAccountId;

        // A down-payment invoice must credit a liability account (deposits aren't earned revenue
        // yet), not the normal Revenue account — forced here regardless of any RevenueAccountId
        // the caller supplies per line, so the accounting can't be steered wrong.
        var depositsAccountId = defaults.CustomerDepositsAccountId;

        var lines = new List<InvoiceLine>();
        var total = 0m;
        foreach (var line in request.Lines)
        {
            if (line.Quantity <= 0)
            {
                return BadRequest(_localizer["LineQuantityMustBePositive"].Value);
            }

            if (line.UnitPrice < 0)
            {
                return BadRequest(_localizer["LineUnitPriceNonNegative"].Value);
            }

            var discountPercent = line.DiscountPercent ?? 0m;
            if (discountPercent < 0 || discountPercent > 100)
            {
                return BadRequest(_localizer["LineDiscountOutOfRange"].Value);
            }

            var revenueAccountId = request.DocumentType == DocumentType.DownPayment
                ? depositsAccountId
                : line.RevenueAccountId ?? defaultRevenueAccountId;
            if (!validAccountIds.Contains(revenueAccountId))
            {
                return BadRequest(string.Format(_localizer["RevenueAccountNotBelongToCompany"], revenueAccountId));
            }

            total += line.Quantity * line.UnitPrice * (1 - discountPercent / 100m);

            lines.Add(new InvoiceLine
            {
                Id = Guid.NewGuid(),
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                DiscountPercent = discountPercent,
                TaxDefinitionId = line.TaxDefinitionId,
                RevenueAccountId = revenueAccountId
            });
        }

        if (total <= 0)
        {
            return BadRequest(_localizer["InvoiceMustBePositiveTotal"].Value);
        }

        // Track A (v2 release): a SalesReturn is a correction of a specific prior invoice, unlike
        // CreditNote/DebitNote/DownPayment where OriginalInvoiceId stays optional.
        if (request.DocumentType == DocumentType.SalesReturn && request.OriginalInvoiceId is null)
        {
            return BadRequest(_localizer["OriginalInvoiceRequiredForSalesReturn"].Value);
        }

        if (request.OriginalInvoiceId is { } originalInvoiceId)
        {
            var originalExists = await _db.Invoices.AsNoTracking()
                .AnyAsync(i => i.Id == originalInvoiceId && i.CompanyId == companyId);
            if (!originalExists)
            {
                return BadRequest(_localizer["OriginalInvoiceNotBelongToCompany"].Value);
            }
        }

        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            PartnerId = request.PartnerId,
            IssueDate = request.IssueDate,
            DueDate = request.DueDate,
            DocumentType = request.DocumentType,
            OriginalInvoiceId = request.OriginalInvoiceId,
            Lines = lines
        };

        // A3 (v2 release): a proforma never posts (see Post()'s rejection below), so unlike every
        // other document type — which numbers only on a successful post — a proforma is numbered
        // right here at creation, off its own PRO-#### series, since creation is the only moment
        // it will ever exist to be numbered. Row-locked the same way posting numbers everything
        // else, to keep the series gapless under concurrent creates.
        if (request.DocumentType == DocumentType.Proforma)
        {
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

                invoice.InvoiceNumber = _documentNumberService.ReserveNext(company, DocumentType.Proforma);

                _db.Invoices.Add(invoice);
                await _db.SaveChangesAsync();

                if (transaction is not null)
                {
                    await transaction.CommitAsync();
                }

                return StatusCode(StatusCodes.Status201Created, ToResponse(invoice));
            }
            finally
            {
                if (transaction is not null)
                {
                    await transaction.DisposeAsync();
                }
            }
        }

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

        return Ok(await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId, invoice.DocumentType));
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
            return BadRequest(_localizer["AmountMustBePositive"].Value);
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
            return BadRequest(_localizer["InvoiceMustBePostedForPayment"].Value);
        }

        var cashOrBankAccount = await _db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.CashOrBankAccountId && a.CompanyId == companyId);
        if (cashOrBankAccount is null || (cashOrBankAccount.AccountSubType != AccountSubType.Cash && cashOrBankAccount.AccountSubType != AccountSubType.Bank))
        {
            return BadRequest(_localizer["InvalidCashOrBankAccount"].Value);
        }

        var receivableAccountId = await GetReceivableAccountIdAsync(companyId);
        if (receivableAccountId == Guid.Empty)
        {
            return BadRequest(_localizer["NoReceivableAccount"].Value);
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

            var balance = await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId, invoice.DocumentType);
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

    // Applies a Posted credit note against this invoice by feeding the credit note's own AR line
    // to ReconciliationCreator as the settlement line, instead of creating a new one — the same
    // double-spend/over-consumption protection Fix 1 built for record-payment applies here for
    // free (see CLAUDE.md's backend fixes pass), and the partner-match check in
    // ReconciliationValidator already covers "same partner as the target invoice."
    [HttpPost("{id:guid}/apply-credit-note")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(ApplyCreditNoteResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ApplyCreditNoteResponse>> ApplyCreditNote(Guid companyId, Guid id, ApplyCreditNoteRequest request)
    {
        if (request.Amount <= 0)
        {
            return BadRequest(_localizer["AmountMustBePositive"].Value);
        }

        var invoice = await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        var creditNote = await _db.Invoices.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == request.CreditNoteId && i.CompanyId == companyId);
        if (creditNote is null)
        {
            return NotFound();
        }

        if (creditNote.DocumentType != DocumentType.CreditNote || creditNote.State != InvoiceState.Posted)
        {
            return BadRequest(_localizer["InvalidCreditNote"].Value);
        }

        var receivableAccountId = await GetReceivableAccountIdAsync(companyId);

        var creditNoteLineId = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntryId == creditNote.JournalEntryId && l.AccountId == receivableAccountId)
            .Select(l => l.Id)
            .FirstOrDefaultAsync();
        if (creditNoteLineId == Guid.Empty)
        {
            return BadRequest(_localizer["CreditNoteNoReceivableLine"].Value);
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

            var result = await ReconciliationCreator.TryCreateAsync(_db, companyId, id, null, creditNoteLineId, request.Amount);
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

            var balance = await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId, invoice.DocumentType);
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

    // Applies a Posted down-payment invoice against this invoice in one transaction, doing two
    // things that must not happen independently: (a) nets the down payment's own AR line against
    // this invoice's outstanding balance, same ReconciliationCreator mechanism as ApplyCreditNote;
    // (b) posts a reclassification JournalEntry (Debit Customer Deposits / Credit Revenue) so the
    // liability the down-payment invoice recognized actually clears instead of sitting on the
    // balance sheet forever. The reclassified amount is the NET portion of the applied amount —
    // proportional to the down payment's own net/gross ratio — because the applied amount nets
    // against AR gross (including VAT already recognized at the down-payment invoice's post time),
    // but only the net portion was ever credited to Customer Deposits; VAT accounts are not
    // touched again here.
    [HttpPost("{id:guid}/apply-down-payment")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(ApplyDownPaymentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ApplyDownPaymentResponse>> ApplyDownPayment(Guid companyId, Guid id, ApplyDownPaymentRequest request)
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

        var invoice = await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        var downPayment = await _db.Invoices.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == request.DownPaymentInvoiceId && i.CompanyId == companyId);
        if (downPayment is null)
        {
            return NotFound();
        }

        if (downPayment.DocumentType != DocumentType.DownPayment || downPayment.State != InvoiceState.Posted)
        {
            return BadRequest(_localizer["InvalidDownPayment"].Value);
        }

        var defaults = await GetAccountDefaultsAsync(companyId);
        if (defaults is null)
        {
            return BadRequest(_localizer["NoAccountDefaults"].Value);
        }

        var receivableAccountId = defaults.ReceivableAccountId;
        var depositsAccountId = defaults.CustomerDepositsAccountId;
        var revenueAccountId = defaults.RevenueAccountId;

        var journal = await _db.Journals.AsNoTracking().FirstOrDefaultAsync(j => j.CompanyId == companyId);
        if (journal is null)
        {
            return BadRequest(_localizer["NoJournalToPost"].Value);
        }

        var downPaymentArLineId = await _db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntryId == downPayment.JournalEntryId && l.AccountId == receivableAccountId)
            .Select(l => l.Id)
            .FirstOrDefaultAsync();
        if (downPaymentArLineId == Guid.Empty)
        {
            return BadRequest(_localizer["DownPaymentNoReceivableLine"].Value);
        }

        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            if (transaction is not null)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM journal_entry_lines WHERE \"Id\" = {downPaymentArLineId} FOR UPDATE");
            }

            var downPaymentGrossTotal = await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntryId == downPayment.JournalEntryId && l.AccountId == receivableAccountId)
                .SumAsync(l => l.Debit);

            var downPaymentNetTotal = await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntryId == downPayment.JournalEntryId && l.AccountId == depositsAccountId)
                .SumAsync(l => l.Credit);

            var result = await ReconciliationCreator.TryCreateAsync(_db, companyId, id, null, downPaymentArLineId, request.Amount);
            if (result.Status == ReconciliationCreationStatus.NotFound)
            {
                return NotFound();
            }

            if (result.Status == ReconciliationCreationStatus.ValidationFailed)
            {
                return BadRequest(result.Error);
            }

            var reclassifiedAmount = downPaymentGrossTotal == 0m
                ? 0m
                : Math.Round(downPaymentNetTotal * request.Amount / downPaymentGrossTotal, 2, MidpointRounding.AwayFromZero);

            var reclassEntry = new JournalEntry
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                JournalId = journal.Id,
                Date = DateOnly.FromDateTime(DateTime.UtcNow),
                Reference = $"Down payment reclassification for {invoice.InvoiceNumber}",
                Lines =
                {
                    new JournalEntryLine { Id = Guid.NewGuid(), AccountId = depositsAccountId, Debit = reclassifiedAmount, Credit = 0m },
                    new JournalEntryLine { Id = Guid.NewGuid(), AccountId = revenueAccountId, Debit = 0m, Credit = reclassifiedAmount }
                }
            };

            try
            {
                reclassEntry.Post(company);
            }
            catch (Exception ex) when (
                ex is InvalidOperationException or
                UnbalancedJournalEntryException or
                AccountingLockDateViolationException or
                TaxLockDateViolationException)
            {
                return BadRequest(ex.Message);
            }

            _db.JournalEntries.Add(reclassEntry);
            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            var balance = await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId, invoice.DocumentType);
            return StatusCode(StatusCodes.Status201Created,
                new ApplyDownPaymentResponse(ToReconciliationResponse(result.Reconciliation!), balance, reclassEntry.Id, reclassifiedAmount));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private async Task<DocumentBalanceResponse> ComputeBalanceAsync(Guid companyId, Guid invoiceId, Guid? journalEntryId, DocumentType documentType)
    {
        // A1 (v2 release): SalesReturn posts through the same isCreditNote mechanics as
        // CreditNote (its own AR control line is Credit-sided, not Debit-sided like a normal
        // invoice/DebitNote/DownPayment) — same "own total, computed from its own control line"
        // fix this method already applies to CreditNote/DownPayment.
        var isSourceDocument = documentType is DocumentType.CreditNote or DocumentType.DownPayment or DocumentType.SalesReturn;
        var creditSidedControlLine = documentType is DocumentType.CreditNote or DocumentType.SalesReturn;

        var total = 0m;
        Guid? controlLineId = null;
        if (journalEntryId is { } jeId)
        {
            var receivableAccountId = await GetReceivableAccountIdAsync(companyId);

            if (isSourceDocument)
            {
                var controlLine = await _db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == jeId && l.AccountId == receivableAccountId)
                    .Select(l => new { l.Id, l.Debit, l.Credit })
                    .FirstOrDefaultAsync();
                if (controlLine is not null)
                {
                    controlLineId = controlLine.Id;
                    total = creditSidedControlLine ? controlLine.Credit : controlLine.Debit;
                }
            }
            else
            {
                total = await _db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == jeId && l.AccountId == receivableAccountId)
                    .SumAsync(l => l.Debit);
            }
        }

        var reconciled = isSourceDocument
            ? controlLineId is { } lineId ? await ReconciliationCreator.SumReconciledForLineAsync(_db, lineId) : 0m
            : await _db.Reconciliations.AsNoTracking().Where(r => r.InvoiceId == invoiceId).SumAsync(r => r.Amount);

        return new DocumentBalanceResponse(total, reconciled, total - reconciled);
    }

    private static ReconciliationResponse ToReconciliationResponse(Reconciliation r) =>
        new(r.Id, r.InvoiceId, r.BillId, r.JournalEntryLineId, r.Amount, r.ReconciledAt);

    private Task<CompanyAccountDefaults?> GetAccountDefaultsAsync(Guid companyId) =>
        _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);

    private async Task<Guid> GetReceivableAccountIdAsync(Guid companyId) =>
        (await GetAccountDefaultsAsync(companyId))?.ReceivableAccountId ?? Guid.Empty;

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

            // A3 (v2 release): a proforma is an offer, not a legal invoice — it must never post a
            // journal entry, consume a fiscal invoice number, or appear in the VAT return. Checked
            // as early as possible (right after we know the document type) so nothing further
            // below ever runs for a proforma.
            if (invoice.DocumentType == DocumentType.Proforma)
            {
                return BadRequest(_localizer["ProformaCannotBePosted"].Value);
            }

            var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == invoice.PartnerId);

            var journal = await _db.Journals.FirstOrDefaultAsync(j => j.CompanyId == companyId);
            if (journal is null)
            {
                return BadRequest(_localizer["NoJournalToPost"].Value);
            }

            var defaults = await GetAccountDefaultsAsync(companyId);
            if (defaults is null || defaults.ReceivableAccountId == Guid.Empty)
            {
                return BadRequest(_localizer["NoReceivableAccount"].Value);
            }

            var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
                .Include(t => t.RepartitionLines)
                .Where(t => t.CompanyId == companyId)
                .ToDictionaryAsync(t => t.Id);

            // 60_Posting_Rules R07/R08/R09 (BLOCK) — checked here, not at Create, for the same
            // reason tax-definition existence itself is only checked at post time: a Draft can
            // reference a not-yet-final tax choice, per this codebase's established pattern.
            var lineAccountsById = await _db.Accounts.AsNoTracking()
                .Where(a => invoice.Lines.Select(l => l.RevenueAccountId).Contains(a.Id))
                .ToDictionaryAsync(a => a.Id);
            foreach (var line in invoice.Lines)
            {
                if (line.TaxDefinitionId is not { } taxDefId || !taxDefinitionsById.TryGetValue(taxDefId, out var taxDef) || taxDef.Code is null)
                {
                    continue;
                }

                var account = lineAccountsById[line.RevenueAccountId];
                try
                {
                    PostingRuleValidator.ValidateVatCounterpartyTaxNumber(taxDef.Code, invoice.PartnerId, partner?.TaxNumber);
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
                journalEntry = invoice.Post(
                    company, journal.Id, defaults.ReceivableAccountId, _taxComputationService, taxDefinitionsById,
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

            // A1 (v2 release): a sales return may be partial but must never exceed what the
            // original invoice still has un-returned. Checked here, after invoice.Post() already
            // succeeded, before numbering/SaveChangesAsync — nothing is persisted if this fails,
            // same "deferred to post time" discipline as tax-definition validity and lock dates.
            if (invoice.DocumentType == DocumentType.SalesReturn)
            {
                if (invoice.OriginalInvoiceId is not { } originalInvoiceId)
                {
                    return BadRequest(_localizer["OriginalInvoiceRequiredForSalesReturn"].Value);
                }

                if (transaction is not null)
                {
                    await _db.Database.ExecuteSqlInterpolatedAsync(
                        $"SELECT \"Id\" FROM invoices WHERE \"Id\" = {originalInvoiceId} FOR UPDATE");
                }

                var original = await _db.Invoices.AsNoTracking()
                    .FirstOrDefaultAsync(i => i.Id == originalInvoiceId && i.CompanyId == companyId);
                if (original is null || original.State != InvoiceState.Posted)
                {
                    return BadRequest(_localizer["OriginalInvoiceMustBePostedForReturn"].Value);
                }

                var originalTotal = original.JournalEntryId is { } originalJournalEntryId
                    ? await _db.JournalEntryLines.AsNoTracking()
                        .Where(l => l.JournalEntryId == originalJournalEntryId && l.AccountId == defaults.ReceivableAccountId)
                        .SumAsync(l => l.Debit)
                    : 0m;

                var otherReturnJournalEntryIds = await _db.Invoices.AsNoTracking()
                    .Where(i => i.CompanyId == companyId && i.OriginalInvoiceId == originalInvoiceId &&
                        i.DocumentType == DocumentType.SalesReturn && i.State == InvoiceState.Posted && i.Id != invoice.Id)
                    .Select(i => i.JournalEntryId)
                    .ToListAsync();
                var alreadyReturned = otherReturnJournalEntryIds.Count == 0
                    ? 0m
                    : await _db.JournalEntryLines.AsNoTracking()
                        .Where(l => otherReturnJournalEntryIds.Contains(l.JournalEntryId) && l.AccountId == defaults.ReceivableAccountId)
                        .SumAsync(l => l.Credit);

                var thisReturnAmount = journalEntry.Lines.Single(l => l.AccountId == defaults.ReceivableAccountId).Credit;

                if (alreadyReturned + thisReturnAmount > originalTotal)
                {
                    var remaining = originalTotal - alreadyReturned;
                    return BadRequest(string.Format(_localizer["SalesReturnExceedsRemainingOriginalAmount"], thisReturnAmount, remaining));
                }
            }

            // S0.1: numbering happens here, after Post() already succeeded, inside the same
            // row-locked transaction — a failed Post() returns 400 above and never reaches this.
            invoice.InvoiceNumber = _documentNumberService.ReserveNext(company, invoice.DocumentType);
            journalEntry.Reference = invoice.InvoiceNumber;

            journalEntry.PostedByUserId = CurrentUserId;
            journalEntry.SourceDocumentId = invoice.Id;
            journalEntry.SequenceNumber = JournalSequencer.ReserveNext(journal);

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

    // A3 (v2 release): a proforma is an offer, never posted (see Post()'s rejection above) —
    // converting creates a new, independent Draft invoice copying the proforma's partner and
    // every line verbatim. The link back reuses OriginalInvoiceId (already means "the other
    // document this one relates to") rather than a dedicated column, to avoid a migration for
    // this alone; the proforma itself is left as-is, untouched, still available for reference.
    [HttpPost("{id:guid}/convert-to-invoice")]
    [RequireCompanyAccess(writeAccess: true)]
    [ProducesResponseType(typeof(InvoiceResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<InvoiceResponse>> ConvertToInvoice(Guid companyId, Guid id)
    {
        var proforma = await _db.Invoices.AsNoTracking().Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (proforma is null)
        {
            return NotFound();
        }

        if (proforma.DocumentType != DocumentType.Proforma)
        {
            return BadRequest(_localizer["InvalidProformaForConversion"].Value);
        }

        var invoice = new Invoice
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            PartnerId = proforma.PartnerId,
            IssueDate = DateOnly.FromDateTime(DateTime.UtcNow),
            DueDate = proforma.DueDate,
            DocumentType = DocumentType.Invoice,
            OriginalInvoiceId = proforma.Id,
            Lines = proforma.Lines.Select(l => new InvoiceLine
            {
                Id = Guid.NewGuid(),
                Description = l.Description,
                Quantity = l.Quantity,
                UnitPrice = l.UnitPrice,
                DiscountPercent = l.DiscountPercent,
                TaxDefinitionId = l.TaxDefinitionId,
                RevenueAccountId = l.RevenueAccountId
            }).ToList()
        };

        _db.Invoices.Add(invoice);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(invoice));
    }

    private static InvoiceResponse ToResponse(Invoice i) => new(
        i.Id,
        i.PartnerId,
        i.InvoiceNumber,
        i.IssueDate,
        i.DueDate,
        i.State.ToString(),
        i.DocumentType,
        i.OriginalInvoiceId,
        i.JournalEntryId,
        i.Lines.Select(l => new InvoiceLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.RevenueAccountId, l.DiscountPercent)).ToList());
}
