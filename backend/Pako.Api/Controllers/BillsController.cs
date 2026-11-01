using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Domain.Documents;
using Pako.Domain.Inventory;
using Pako.Api.Services;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
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
    private readonly CompanyAccessContext _access;

    // HR module: same partner scoping as InvoicesController — hidden bills 404, writes naming an
    // unassigned partner are refused.
    public BillsController(PakoDbContext db, ITaxComputationService taxComputationService, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access)
    {
        _db = db;
        _taxComputationService = taxComputationService;
        _localizer = localizer;
        _access = access;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<List<BillResponse>>> List(Guid companyId)
    {
        var bills = await _db.Bills.AsNoTracking().VisibleTo(_access)
            .Include(b => b.Lines)
            .Where(b => b.CompanyId == companyId)
            .OrderByDescending(b => b.IssueDate)
            .ToListAsync();

        return Ok(bills.Select(ToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<BillResponse>> Get(Guid companyId, Guid id)
    {
        var bill = await _db.Bills.AsNoTracking().VisibleTo(_access)
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
    [RequireCompanyAccess(module: AccessModule.Purchases, approve: true)]
    public async Task<IActionResult> Discard(Guid companyId, Guid id)
    {
        var bill = await _db.Bills.VisibleTo(_access).FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
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
        Guid companyId, List<CreateBillLineRequest> requestLines, bool isVatRegistered, Guid partnerId)
    {
        if (requestLines.Count == 0)
        {
            return (null, 0m, BadRequest(_localizer["BillMustHaveLines"].Value));
        }

        // docs/INVENTORY_PLAN.md §12 P5: a line may bill a purchase order line, which must belong to
        // a confirmed order from the same vendor.
        var orderLineIds = requestLines.Where(l => l.PurchaseOrderLineId != null).Select(l => l.PurchaseOrderLineId!.Value).Distinct().ToList();
        if (orderLineIds.Count > 0)
        {
            var validOrderLines = await _db.PurchaseOrderLines.AsNoTracking()
                .CountAsync(l => orderLineIds.Contains(l.Id) && l.PurchaseOrder!.CompanyId == companyId
                    && l.PurchaseOrder.PartnerId == partnerId && l.PurchaseOrder.State == PurchaseOrderState.Confirmed);
            if (validOrderLines != orderLineIds.Count)
            {
                return (null, 0m, BadRequest(_localizer["BillPurchaseOrderLineInvalid"].Value));
            }
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

        // B6: an item with no default of its own falls back to the company's default — see
        // InvoicesController.BuildAndValidateLinesAsync's identical comment for the reasoning.
        var itemIds = requestLines.Where(l => l.ItemId.HasValue).Select(l => l.ItemId!.Value).ToHashSet();
        var itemsById = itemIds.Count == 0
            ? new Dictionary<Guid, Item>()
            : await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id) && i.CompanyId == companyId).ToDictionaryAsync(i => i.Id);

        // docs/INVENTORY_PLAN.md D9: the item's category supplies accounts the item doesn't set.
        var categoryIdsForLines = itemsById.Values.Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToList();
        var categoriesById = categoryIdsForLines.Count == 0
            ? new Dictionary<Guid, Pako.Domain.Inventory.ItemCategory>()
            : await _db.ItemCategories.AsNoTracking().Where(c => categoryIdsForLines.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        var stockService = new StockService(_db, _localizer);
        var stockAccounts = await stockService.AccountsForSafeAsync(companyId,
            itemsById.Values.Where(i => i.TrackInventory && i.Type == ItemType.Goods));
        // §5.3: stock accounts move only with stock — a line with no tracked item can't post to one.
        var stockAccountIdsInUse = await stockService.StockAccountIdsInUseAsync(companyId);

        var lines = new List<BillLine>();
        var total = 0m;
        foreach (var line in requestLines)
        {
            var item = line.ItemId is { } itemId && itemsById.TryGetValue(itemId, out var foundItem) ? foundItem : null;

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

            var taxDefinitionId = line.TaxDefinitionId ?? item?.DefaultTaxDefinitionId;

            // C2: same rule as InvoicesController.Create — see its comment.
            if (isVatRegistered && taxDefinitionId is null)
            {
                return (null, 0m, BadRequest(_localizer["TaxCodeRequired"].Value));
            }

            // VAT eligibility: same check as InvoicesController — see its comment.
            if (taxDefinitionId is { } eligibilityTaxId)
            {
                var taxDef = await _db.TaxDefinitions.AsNoTracking()
                    .FirstOrDefaultAsync(t => t.Id == eligibilityTaxId && t.CompanyId == companyId);
                if (taxDef is not null && !VatEligibilityValidator.IsEligible(isVatRegistered, taxDef))
                {
                    var reasonKey = VatEligibilityValidator.GetIneligibilityReason(isVatRegistered, taxDef);
                    return (null, 0m, BadRequest(_localizer[reasonKey ?? "VatCodeNotEligible_General"].Value));
                }
            }

            var category = item?.CategoryId is { } categoryId ? categoriesById.GetValueOrDefault(categoryId) : null;
            // A stock-tracked item's line goes to its stock account (it's forced there at posting too).
            var expenseAccountId = item is not null && stockAccounts.TryGetValue(item.Id, out var stockAccount)
                ? stockAccount.InventoryAccountId
                : line.ExpenseAccountId ?? item?.DefaultExpenseAccountId ?? category?.ExpenseAccountId ?? defaultExpenseAccountId;
            if (!validAccountIds.Contains(expenseAccountId))
            {
                return (null, 0m, BadRequest(string.Format(_localizer["ExpenseAccountNotBelongToCompany"], expenseAccountId)));
            }
            if (!(item is not null && stockAccounts.ContainsKey(item.Id)) && stockAccountIdsInUse.Contains(expenseAccountId))
            {
                var code = await _db.Accounts.AsNoTracking().Where(a => a.Id == expenseAccountId).Select(a => a.Code).FirstAsync();
                return (null, 0m, BadRequest(string.Format(_localizer["StockAccountNeedsItem"].Value, code)));
            }

            if (StockService.ResolveUnit(item, line.UnitName) is not { } unit)
            {
                return (null, 0m, BadRequest(string.Format(_localizer["LineUnitUnknown"].Value, line.UnitName)));
            }

            total += line.Quantity * line.UnitPrice * (1 - discountPercent / 100m);

            lines.Add(new BillLine
            {
                Id = Guid.NewGuid(),
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                DiscountPercent = discountPercent,
                TaxDefinitionId = taxDefinitionId,
                ExpenseAccountId = expenseAccountId,
                ItemId = line.ItemId,
                PurchaseOrderLineId = line.PurchaseOrderLineId,
                CostCodeId = line.CostCodeId,
                UnitName = unit.Name,
                UnitFactor = unit.Factor,
                LotNumber = string.IsNullOrWhiteSpace(line.LotNumber) ? null : line.LotNumber.Trim(),
                ExpiryDate = line.ExpiryDate
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
            var originalExists = await _db.Bills.AsNoTracking().VisibleTo(_access)
                .AnyAsync(b => b.Id == id && b.CompanyId == companyId);
            if (!originalExists)
            {
                return BadRequest(_localizer["OriginalBillNotBelongToCompany"].Value);
            }
        }

        return null;
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    [ProducesResponseType(typeof(BillResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<BillResponse>> Create(Guid companyId, CreateBillRequest request)
    {
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            return NotFound();
        }

        if (!_access.CanSeePartner(request.PartnerId))
        {
            return BadRequest(_localizer["PartnerNotAssigned"].Value);
        }

        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null || !partner.IsVendor)
        {
            return BadRequest(_localizer["InvalidVendorPartner"].Value);
        }

        var (lines, _, linesError) = await BuildAndValidateLinesAsync(companyId, request.Lines, company.IsVatRegistered, request.PartnerId);
        if (linesError is not null)
        {
            return linesError;
        }

        var originalBillError = await ValidateOriginalBillAsync(companyId, request.DocumentType, request.OriginalBillId);
        if (originalBillError is not null)
        {
            return originalBillError;
        }

        if (request.ProjectId is { } projectId && !await _db.Projects.AnyAsync(p => p.Id == projectId && p.CompanyId == companyId))
        {
            return BadRequest(_localizer["ProjectNotFound"].Value);
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
            PriceMode = request.PriceMode,
            WarehouseId = request.WarehouseId,
            ProjectId = request.ProjectId,
            Lines = lines!
        };

        if (request.Payment is null)
        {
            _db.Bills.Add(bill);
            await _db.SaveChangesAsync();

            return StatusCode(StatusCodes.Status201Created, ToResponse(bill));
        }

        // C5: "cash paid at the counter is known when the bill is entered, a transfer is only
        // known once it appears on the bank statement" — a bank payment methods can never be used
        // here, only Cash; a bank payment is recorded later through the ordinary
        // .../record-payment route once it clears. Posts the bill and records the payment in one
        // transaction, same atomicity shape as InvoicesController.Create's C3 branch.
        var paymentMethod = await _db.PaymentMethods.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == request.Payment.PaymentMethodId && m.CompanyId == companyId);
        if (paymentMethod is null)
        {
            return BadRequest(_localizer["InvalidPaymentMethod"].Value);
        }

        if (paymentMethod.Kind != PaymentMethodKind.Cash)
        {
            return BadRequest(_localizer["BankPaymentNotAllowedAtBillCreation"].Value);
        }

        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            var trackedCompany = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (trackedCompany is null)
            {
                return NotFound();
            }

            _db.Bills.Add(bill);

            var postError = await PostDraftBillAsync(trackedCompany, bill);
            if (postError is not null)
            {
                return postError;
            }

            await _db.SaveChangesAsync();

            var outcome = await TryRecordPaymentAsync(
                trackedCompany, bill, request.Payment.Amount, paymentMethod.LedgerAccountId,
                request.Payment.Date ?? request.IssueDate);
            if (outcome.Error is not null)
            {
                return outcome.Error;
            }

            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            return StatusCode(StatusCodes.Status201Created, ToResponse(bill));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    // A5 (v2 release): mirror of InvoicesController.Update.
    [HttpPut("{id:guid}")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    public async Task<ActionResult<BillResponse>> Update(Guid companyId, Guid id, UpdateBillRequest request)
    {
        var bill = await _db.Bills.VisibleTo(_access).Include(b => b.Lines)
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

        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null)
        {
            return NotFound();
        }

        if (!_access.CanSeePartner(request.PartnerId))
        {
            return BadRequest(_localizer["PartnerNotAssigned"].Value);
        }

        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId);
        if (partner is null || !partner.IsVendor)
        {
            return BadRequest(_localizer["InvalidVendorPartner"].Value);
        }

        var (lines, _, linesError) = await BuildAndValidateLinesAsync(companyId, request.Lines, company.IsVatRegistered, request.PartnerId);
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

        if (request.ProjectId is { } projectId && !await _db.Projects.AnyAsync(p => p.Id == projectId && p.CompanyId == companyId))
        {
            return BadRequest(_localizer["ProjectNotFound"].Value);
        }

        bill.PartnerId = request.PartnerId;
        bill.VendorReference = request.VendorReference;
        bill.IssueDate = request.IssueDate;
        bill.DueDate = request.DueDate;
        bill.DocumentType = request.DocumentType;
        bill.OriginalBillId = request.OriginalBillId;
        bill.InternalNotes = request.InternalNotes;
        bill.WarehouseId = request.WarehouseId;
        bill.ProjectId = request.ProjectId;

        await _db.SaveChangesAsync();

        bill.Lines = lines;
        return Ok(ToResponse(bill));
    }

    // A5 (v2 release): mirror of InvoicesController.EditPosted.
    [HttpPatch("{id:guid}")]
    [RequireCompanyAccess(module: AccessModule.Purchases, approve: true)]
    public async Task<ActionResult<BillResponse>> EditPosted(Guid companyId, Guid id, EditPostedBillRequest request)
    {
        var bill = await _db.Bills.VisibleTo(_access).Include(b => b.Lines)
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
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<DocumentBalanceResponse>> Balance(Guid companyId, Guid id)
    {
        var bill = await _db.Bills.AsNoTracking().VisibleTo(_access).FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        return Ok(await ComputeBalanceAsync(companyId, id, bill.JournalEntryId, bill.DocumentType, bill.PartnerId));
    }

    // Atomic replacement for the client's old draft-journal-entry -> post -> reconcile 3-call
    // sequence — see InvoicesController.RecordPayment's comment; this is the AP mirror (Debit
    // AP / Credit Cash-or-Bank instead of Debit Cash-or-Bank / Credit AR).
    [HttpPost("{id:guid}/record-payment")]
    [RequireCompanyAccess(module: AccessModule.Purchases, approve: true)]
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

        var bill = await _db.Bills.AsNoTracking().VisibleTo(_access).FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
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

        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            var outcome = await TryRecordPaymentAsync(company, bill, request.Amount, cashOrBankAccount.Id, request.Date);
            if (outcome.Error is not null)
            {
                return outcome.Error;
            }

            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            var balance = await ComputeBalanceAsync(companyId, id, bill.JournalEntryId, bill.DocumentType, bill.PartnerId);
            return StatusCode(StatusCodes.Status201Created, new RecordPaymentResponse(ToReconciliationResponse(outcome.Reconciliation!), balance));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private readonly record struct RecordPaymentOutcome(ActionResult? Error, Reconciliation? Reconciliation);

    // C5: the settlement-entry-plus-reconcile half of "record a payment," shared by RecordPayment
    // above and Create's optional inline-payment branch below — AP mirror of
    // InvoicesController.TryRecordPaymentAsync (Debit AP / Credit Cash-or-Bank instead of Debit
    // Cash-or-Bank / Credit AR).
    private async Task<RecordPaymentOutcome> TryRecordPaymentAsync(
        Company company, Bill bill, decimal amount, Guid cashOrBankAccountId, DateOnly date)
    {
        var payableAccountId = await GetPayableAccountIdAsync(company.Id, bill.PartnerId);
        if (payableAccountId == Guid.Empty)
        {
            return new RecordPaymentOutcome(BadRequest(_localizer["NoPayableAccount"].Value), null);
        }

        // B9: Cash or Bank journal, whichever matches the account the payment actually moved
        // through — not "the first journal for this company" (ambiguous now that Sale/Purchase/
        // Cash/Bank/General all exist).
        var cashOrBankAccountSubType = await _db.Accounts.AsNoTracking()
            .Where(a => a.Id == cashOrBankAccountId).Select(a => a.AccountSubType).FirstOrDefaultAsync();
        var journal = await JournalResolver.GetAsync(_db, company.Id, JournalResolver.SettlementJournalType(cashOrBankAccountSubType));
        if (journal is null)
        {
            return new RecordPaymentOutcome(BadRequest(_localizer["NoJournalToPost"].Value), null);
        }

        // A Purchase Return or Credit Note is a credit document — "recording a payment" against it
        // means receiving a refund from the supplier: cash comes IN (Debit Cash) and the supplier's
        // credit balance is cleared (Credit AP). Normal bills are the reverse: cash OUT (Credit
        // Cash), payable cleared (Debit AP).
        var isCreditDocument = bill.DocumentType is DocumentType.CreditNote or DocumentType.PurchaseReturn;

        var settlementEntry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = journal.Id,
            Date = date,
            Reference = isCreditDocument
                ? $"Refund for {bill.VendorReference}"
                : $"Payment for {bill.VendorReference}",
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = payableAccountId, PartnerId = bill.PartnerId,
                    Debit = isCreditDocument ? 0m : amount,
                    Credit = isCreditDocument ? amount : 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = cashOrBankAccountId,
                    Debit = isCreditDocument ? amount : 0m,
                    Credit = isCreditDocument ? 0m : amount }
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
            return new RecordPaymentOutcome(BadRequest(ex.Message), null);
        }

        _db.JournalEntries.Add(settlementEntry);
        await _db.SaveChangesAsync();

        var settlementLineId = settlementEntry.Lines.Single(l => l.AccountId == payableAccountId).Id;
        var result = await ReconciliationCreator.TryCreateAsync(_db, company.Id, null, bill.Id, settlementLineId, amount);
        if (result.Status == ReconciliationCreationStatus.NotFound)
        {
            return new RecordPaymentOutcome(NotFound(), null);
        }

        if (result.Status == ReconciliationCreationStatus.ValidationFailed)
        {
            return new RecordPaymentOutcome(BadRequest(result.Error), null);
        }

        return new RecordPaymentOutcome(null, result.Reconciliation);
    }

    // AP mirror of InvoicesController.ApplyCreditNote — feeds the vendor credit note's own AP
    // line to ReconciliationCreator as the settlement line.
    [HttpPost("{id:guid}/apply-credit-note")]
    [RequireCompanyAccess(module: AccessModule.Purchases, approve: true)]
    [ProducesResponseType(typeof(ApplyCreditNoteResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ApplyCreditNoteResponse>> ApplyCreditNote(Guid companyId, Guid id, ApplyCreditNoteRequest request)
    {
        if (request.Amount <= 0)
        {
            return BadRequest(_localizer["AmountMustBePositive"].Value);
        }

        var bill = await _db.Bills.AsNoTracking().VisibleTo(_access).FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null)
        {
            return NotFound();
        }

        // The credit note must be visible too — otherwise its id becomes an existence oracle.
        var creditNote = await _db.Bills.AsNoTracking().VisibleTo(_access)
            .FirstOrDefaultAsync(b => b.Id == request.CreditNoteId && b.CompanyId == companyId);
        if (creditNote is null)
        {
            return NotFound();
        }

        if (creditNote.DocumentType is not (DocumentType.CreditNote or DocumentType.PurchaseReturn) || creditNote.State != BillState.Posted)
        {
            return BadRequest(_localizer["InvalidCreditNote"].Value);
        }

        var payableAccountId = await GetPayableAccountIdAsync(companyId, bill.PartnerId);

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

            var balance = await ComputeBalanceAsync(companyId, id, bill.JournalEntryId, bill.DocumentType, bill.PartnerId);
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

    private async Task<DocumentBalanceResponse> ComputeBalanceAsync(Guid companyId, Guid billId, Guid? journalEntryId, DocumentType documentType, Guid? partnerId = null)
    {
        // A2 (v2 release): PurchaseReturn posts through the same isCreditNote mechanics as
        // CreditNote — its own AP control line is Debit-sided too, so it needs no separate
        // ternary the way Invoicing's CreditNote-vs-DownPayment split does.
        var isSourceDocument = documentType is DocumentType.CreditNote or DocumentType.PurchaseReturn;

        var total = 0m;
        Guid? controlLineId = null;
        if (journalEntryId is { } jeId)
        {
            var payableAccountId = await GetPayableAccountIdAsync(companyId, partnerId);

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

        // Source documents (CreditNote/PurchaseReturn) can be reconciled two ways:
        // (a) their control line used as a settlement line against another bill (ApplyCreditNote)
        // (b) a cash refund reconciled directly against this document (RecordPayment)
        // Sum both patterns to get the full reconciled amount.
        var reconciledViaControlLine = isSourceDocument && controlLineId is { } lineId
            ? await ReconciliationCreator.SumReconciledForLineAsync(_db, lineId)
            : 0m;
        var reconciledViaDocument = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.BillId == billId).SumAsync(r => r.Amount);
        var reconciled = isSourceDocument
            ? reconciledViaControlLine + reconciledViaDocument
            : reconciledViaDocument;

        return new DocumentBalanceResponse(total, reconciled, total - reconciled);
    }

    private static ReconciliationResponse ToReconciliationResponse(Reconciliation r) =>
        new(r.Id, r.InvoiceId, r.BillId, r.JournalEntryLineId, r.Amount, r.ReconciledAt);

    private Task<CompanyAccountDefaults?> GetAccountDefaultsAsync(Guid companyId) =>
        _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);

    // B8: partner's own PayableAccountId wins when set and the caller has a partner to ask about
    // (every call site that posts, pays, or reads a specific document does); the company's
    // default otherwise — mirrors InvoicesController.GetReceivableAccountIdAsync exactly.
    private async Task<Guid> GetPayableAccountIdAsync(Guid companyId, Guid? partnerId = null)
    {
        if (partnerId is { } id)
        {
            var partnerAccountId = await _db.Partners.AsNoTracking()
                .Where(p => p.Id == id && p.CompanyId == companyId)
                .Select(p => p.PayableAccountId)
                .FirstOrDefaultAsync();
            if (partnerAccountId is { } paId)
            {
                return paId;
            }
        }

        return (await GetAccountDefaultsAsync(companyId))?.PayableAccountId ?? Guid.Empty;
    }

    [HttpGet("{id:guid}/post-preview")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<PostingPreviewResponse>> PostPreview(Guid companyId, Guid id)
    {
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        var bill = await _db.Bills.AsNoTracking().Include(b => b.Lines)
            .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
        if (bill is null) return NotFound();

        var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == bill.PartnerId);
        var journal = await JournalResolver.GetAsync(_db, company.Id, JournalType.Purchase);
        if (journal is null) return BadRequest(_localizer["NoJournalToPost"].Value);

        var defaults = await GetAccountDefaultsAsync(company.Id);
        if (defaults is null) return BadRequest(_localizer["NoAccountDefaults"].Value);

        var payableAccountId = partner?.PayableAccountId ?? defaults.PayableAccountId;
        var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
            .Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == company.Id)
            .ToDictionaryAsync(t => t.Id);

        JournalEntry journalEntry;
        try
        {
            journalEntry = bill.Post(
                company, journal.Id, payableAccountId, _taxComputationService, taxDefinitionsById,
                defaults.ReverseChargeInputVatAccountId, defaults.ReverseChargeOutputVatAccountId);
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }

        var accountIds = journalEntry.Lines.Select(l => l.AccountId).Distinct().ToList();
        var accountsById = await _db.Accounts.AsNoTracking()
            .Where(a => accountIds.Contains(a.Id))
            .ToDictionaryAsync(a => a.Id);

        var lines = journalEntry.Lines.Select(l => new PostingPreviewLineResponse(
            accountsById.TryGetValue(l.AccountId, out var acc) ? acc.Code : "",
            accountsById.TryGetValue(l.AccountId, out var acc2) ? acc2.Name : "",
            l.Debit, l.Credit)).ToList();

        return Ok(new PostingPreviewResponse(lines));
    }

    [HttpPost("{id:guid}/post")]
    [RequireCompanyAccess(module: AccessModule.Purchases, approve: true)]
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

            var bill = await _db.Bills.VisibleTo(_access).Include(b => b.Lines)
                .FirstOrDefaultAsync(b => b.Id == id && b.CompanyId == companyId);
            if (bill is null)
            {
                return NotFound();
            }

            var postError = await PostDraftBillAsync(company, bill);
            if (postError is not null)
            {
                return postError;
            }

            AuditController.Stage(_db, companyId, "Bill", id.ToString(), "Post",
                CurrentUserId.ToString());

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

    // C5: the actual "turn a Draft bill into a Posted one" logic, shared by Post above and
    // Create's optional inline-payment branch below — same extraction rationale as
    // InvoicesController.PostDraftInvoiceAsync. Adds the resulting JournalEntry to the context
    // but does not SaveChanges — the caller owns that (and, for Create, the transaction too).
    // Also absorbs Track A's PurchaseReturn-amount check, which was originally inline in Post()
    // before this extraction existed — see InvoicesController.PostDraftInvoiceAsync's identical
    // reasoning for the SalesReturn check.
    private async Task<ActionResult?> PostDraftBillAsync(Company company, Bill bill)
    {
        var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == bill.PartnerId);

        // B9: every bill/credit-note/purchase-return posts to the Purchase journal.
        var journal = await JournalResolver.GetAsync(_db, company.Id, JournalType.Purchase);
        if (journal is null)
        {
            return BadRequest(_localizer["NoJournalToPost"].Value);
        }

        var defaults = await GetAccountDefaultsAsync(company.Id);
        if (defaults is null)
        {
            return BadRequest(_localizer["NoAccountDefaults"].Value);
        }

        // B8: the partner's own PayableAccountId, if set, wins over the company default — used
        // for every payable-account reference in this method from here on.
        var payableAccountId = partner?.PayableAccountId ?? defaults.PayableAccountId;
        if (payableAccountId == Guid.Empty)
        {
            return BadRequest(_localizer["NoPayableAccount"].Value);
        }

        var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
            .Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == company.Id)
            .ToDictionaryAsync(t => t.Id);

        // docs/INVENTORY_PLAN.md §5.3: a stock-tracked item's line posts to its stock account, not an
        // expense (Odoo 19 swaps the account the same way) — done before validation so the VAT rules
        // check the account actually posted to.
        var stock = new StockService(_db, _localizer);
        var trackedItems = bill.DocumentType is DocumentType.Bill or DocumentType.CreditNote or DocumentType.PurchaseReturn
            ? await stock.TrackedItemsAsync(company.Id, bill.Lines.Select(l => l.ItemId))
            : new Dictionary<Guid, Item>();
        var stockAccounts = new Dictionary<Guid, StockService.ItemAccounts>();
        if (trackedItems.Count > 0)
        {
            try
            {
                stockAccounts = await stock.AccountsForAsync(company.Id, trackedItems.Values);
            }
            catch (StockException ex)
            {
                return BadRequest(ex.Message);
            }
            foreach (var line in bill.Lines)
            {
                if (line.ItemId is { } itemId && stockAccounts.TryGetValue(itemId, out var accounts))
                {
                    line.ExpenseAccountId = accounts.InventoryAccountId;
                }
            }
        }

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
                PostingRuleValidator.ValidateVatCounterpartyTaxNumber(taxDef.Code, bill.PartnerId, partner?.IsVatRegistered ?? false, partner?.TaxNumber, partner?.FiscalNumber);
                if (taxDef.Direction is { } direction && account.Class is { } accountClass)
                {
                    PostingRuleValidator.ValidateVatDirectionAgainstAccountClass(taxDef.Code, direction, accountClass);
                }
                PostingRuleValidator.ValidateVatNotAppliedToControlAccount(taxDef.Code, account.Code);
            }
            catch (MissingCounterpartyTaxNumberException)
            {
                var partnerName = partner?.Name ?? "?";
                if (partner?.IsVatRegistered == true)
                    return BadRequest(string.Format(_localizer["MissingPartnerTaxNumber_R07"].Value, partnerName));
                return BadRequest(string.Format(_localizer["MissingPartnerFiscalNumber_R07"].Value, partnerName));
            }
            catch (Exception ex) when (
                ex is VatDirectionAccountClassMismatchException or
                VatOnControlAccountException)
            {
                return BadRequest(ex.Message);
            }
        }

        // B4: the caller's own effective lock dates — company's own value unless CurrentUserId
        // holds a live exception for that field (AccountLockResolver never touches HardLockDate).
        var effectiveCompany = await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId);

        JournalEntry journalEntry;
        try
        {
            journalEntry = bill.Post(
                effectiveCompany, journal.Id, payableAccountId, _taxComputationService, taxDefinitionsById,
                defaults.ReverseChargeInputVatAccountId, defaults.ReverseChargeOutputVatAccountId);
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException or
            HardLockDateViolationException or
            PurchaseLockDateViolationException or
            InconsistentForeignCurrencyDataException)
        {
            return BadRequest(ex.Message);
        }

        // A2 (v2 release): mirror of InvoicesController.PostDraftInvoiceAsync's SalesReturn check —
        // goods returned to a supplier must not exceed what the original bill still has
        // un-returned. Checked after bill.Post() succeeded, before numbering/SaveChangesAsync.
        if (bill.DocumentType == DocumentType.PurchaseReturn)
        {
            if (bill.OriginalBillId is not { } originalBillId)
            {
                return BadRequest(_localizer["OriginalBillRequiredForPurchaseReturn"].Value);
            }

            if (_db.Database.SupportsRowLocking())
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM bills WHERE \"Id\" = {originalBillId} FOR UPDATE");
            }

            var original = await _db.Bills.AsNoTracking()
                .FirstOrDefaultAsync(b => b.Id == originalBillId && b.CompanyId == company.Id);
            if (original is null || original.State != BillState.Posted)
            {
                return BadRequest(_localizer["OriginalBillMustBePostedForReturn"].Value);
            }

            var originalTotal = original.JournalEntryId is { } originalJournalEntryId
                ? await _db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == originalJournalEntryId && l.AccountId == payableAccountId)
                    .SumAsync(l => l.Credit)
                : 0m;

            var otherReturnJournalEntryIds = await _db.Bills.AsNoTracking()
                .Where(b => b.CompanyId == company.Id && b.OriginalBillId == originalBillId &&
                    b.DocumentType == DocumentType.PurchaseReturn && b.State == BillState.Posted && b.Id != bill.Id)
                .Select(b => b.JournalEntryId)
                .ToListAsync();
            var alreadyReturned = otherReturnJournalEntryIds.Count == 0
                ? 0m
                : await _db.JournalEntryLines.AsNoTracking()
                    .Where(l => otherReturnJournalEntryIds.Contains(l.JournalEntryId) && l.AccountId == payableAccountId)
                    .SumAsync(l => l.Debit);

            var thisReturnAmount = journalEntry.Lines.Single(l => l.AccountId == payableAccountId).Debit;

            if (alreadyReturned + thisReturnAmount > originalTotal)
            {
                var remaining = originalTotal - alreadyReturned;
                return BadRequest(string.Format(_localizer["PurchaseReturnExceedsRemainingOriginalAmount"], thisReturnAmount, remaining));
            }
        }

        if (trackedItems.Count > 0)
        {
            try
            {
                await PostBillStockAsync(stock, company, bill, journalEntry, trackedItems, stockAccounts, taxDefinitionsById);
            }
            catch (StockException ex)
            {
                return BadRequest(ex.Message);
            }
        }

        journalEntry.PostedByUserId = CurrentUserId;
        journalEntry.SourceDocumentId = bill.Id;
        // docs/ERP_VERTICALS_PLAN.md: the bill's expense lines carry its project into the ledger.
        if (bill.ProjectId is { } billProject)
        {
            var expenseAccounts = bill.Lines.Select(l => l.ExpenseAccountId).ToHashSet();
            foreach (var line in journalEntry.Lines.Where(l => expenseAccounts.Contains(l.AccountId))) line.ProjectId = billProject;
        }
        journalEntry.SequenceNumber = JournalSequencer.ReserveNext(journal);

        _db.JournalEntries.Add(journalEntry);
        return null;
    }

    // docs/INVENTORY_PLAN.md §5.3, D13. A bill brings goods in at the line's net amount; a purchase
    // return takes them out (at the average — the gap to the returned price is a cost correction); a
    // supplier credit note changes value only. The stock side goes into the bill's own entry.
    private async Task PostBillStockAsync(StockService stock, Company company, Bill bill, JournalEntry journalEntry,
        Dictionary<Guid, Item> trackedItems, Dictionary<Guid, StockService.ItemAccounts> accounts,
        IReadOnlyDictionary<Guid, TaxDefinition> taxDefinitionsById)
    {
        var location = await stock.DocumentLocationAsync(company.Id, bill.WarehouseId);
        var supplier = await stock.VirtualLocationAsync(company.Id, LocationUsage.Supplier);
        var requests = new List<StockService.MoveRequest>();
        var returnNets = new Dictionary<Guid, decimal>();
        var trackedLines = bill.Lines.Where(l => l.ItemId is { } id && trackedItems.ContainsKey(id)).ToList();
        // Serialized with invoices, stock documents and other bills (they take the same company lock):
        // two bills must not match the same open receipt, and a count must not read a stale book.
        if (trackedLines.Count > 0 && _db.Database.SupportsRowLocking() && _db.Database.CurrentTransaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {company.Id} FOR UPDATE");
        }

        // §12 P6: goods this vendor already delivered on a receipt are billed first — the same order
        // line first, then the oldest receipt — at the receipt's cost, clearing 120800 instead of
        // bringing the stock in twice. A price gap between bill and receipt revalues the stock (or
        // goes to cost of goods sold for what was already sold).
        var openReceipts = bill.DocumentType == DocumentType.Bill
            ? await OpenReceiptLinesAsync(company.Id, bill.PartnerId, trackedLines.Select(l => l.ItemId!.Value).Distinct().ToList())
            : new List<OpenReceiptLine>();
        Guid? grni = null;
        var label = $"{_localizer["StockReceiptMatched"].Value} {bill.VendorReference}".Trim();

        foreach (var line in trackedLines)
        {
            var taxDefinition = line.TaxDefinitionId is { } taxId ? taxDefinitionsById.GetValueOrDefault(taxId) : null;
            var net = DocumentLineCalculator.Calculate(line.Quantity, line.UnitPrice, line.DiscountPercent, line.ExpenseAccountId,
                line.Description, taxDefinition, false, false, _taxComputationService, Guid.Empty, Guid.Empty, bill.PriceMode).NetAmount;
            var itemId = line.ItemId!.Value;
            // §12 P7: stock moves in base units.
            var quantity = line.Quantity * line.UnitFactor;
            switch (bill.DocumentType)
            {
                case DocumentType.PurchaseReturn:
                    returnNets[line.Id] = net;
                    requests.Add(new StockService.MoveRequest(itemId, StockMoveKind.Issue, location.Id, supplier.Id, quantity, SourceLineId: line.Id,
                        LotNumber: line.LotNumber));
                    continue;
                case DocumentType.CreditNote:
                    requests.Add(new StockService.MoveRequest(itemId, StockMoveKind.Revaluation, supplier.Id, location.Id, 0m, -net, line.Id));
                    continue;
            }

            var toBill = quantity;
            var matchedValue = 0m;
            var candidates = openReceipts.Where(r => r.ItemId == itemId && r.Open > 0)
                .OrderBy(r => line.PurchaseOrderLineId is { } po && r.PurchaseOrderLineId == po ? 0 : 1)
                .ThenBy(r => r.Date).ThenBy(r => r.PostedAt);
            foreach (var receipt in candidates)
            {
                if (toBill <= 0) break;
                var take = Math.Min(toBill, receipt.Open);
                // The match that takes the receipt's last units takes what is left of its value, so
                // the parts add up to what the receipt credited 120800 (no cents left behind).
                var value = take == receipt.Open ? receipt.OpenValue : AverageCost.Money(take * receipt.UnitCost);
                receipt.Open -= take;
                receipt.OpenValue -= value;
                toBill -= take;
                matchedValue += value;
                _db.ReceiptMatches.Add(new ReceiptMatch
                {
                    Id = Guid.NewGuid(), CompanyId = company.Id, BillId = bill.Id, BillLineId = line.Id,
                    ReceiptLineId = receipt.LineId, Quantity = take, Value = value,
                });
            }

            var matched = quantity - toBill;
            var netMatched = toBill == 0 ? net : AverageCost.Money(net * matched / quantity);
            if (matched > 0)
            {
                grni ??= await stock.RequiredAccountAsync(company.Id, StockService.GoodsReceivedNotInvoicedCode);
                // The bill line debited stock with its full net; move the receipt's share to 120800.
                StockService.AddPair(journalEntry, grni.Value, accounts[itemId].InventoryAccountId, matchedValue, label);
                if (netMatched != matchedValue)
                {
                    requests.Add(new StockService.MoveRequest(itemId, StockMoveKind.Revaluation, supplier.Id, location.Id, 0m,
                        netMatched - matchedValue, line.Id));
                }
            }
            if (toBill > 0)
            {
                requests.Add(new StockService.MoveRequest(itemId, StockMoveKind.Receipt, supplier.Id, location.Id, toBill, net - netMatched, line.Id,
                    line.LotNumber, line.ExpiryDate));
            }
        }

        if (requests.Count == 0) return;
        var posting = await stock.ApplyAsync(company.Id, bill.IssueDate, StockMoveSource.Bill, bill.Id, bill.VendorReference, requests);
        var corrections = posting.Moves.Select(m => (m.Request.ItemId,
            bill.DocumentType == DocumentType.PurchaseReturn ? m.Value - returnNets[m.Request.SourceLineId!.Value] : m.Correction));
        StockService.AddCorrections(journalEntry, posting, accounts, corrections, _localizer["StockCostCorrection"].Value);
    }

    private sealed class OpenReceiptLine
    {
        public Guid LineId { get; init; }
        public Guid ItemId { get; init; }
        public Guid? PurchaseOrderLineId { get; init; }
        public decimal UnitCost { get; init; }
        public DateOnly Date { get; init; }
        public DateTime? PostedAt { get; init; }
        public decimal Open { get; set; }
        public decimal OpenValue { get; set; }
    }

    // Posted receipt lines from this vendor for these items with quantity not yet matched to a bill.
    // A receipt dated after the bill is matched too: leaving it out would bring the goods in a
    // second time; matching it only leaves 120800 debited between the two dates.
    private async Task<List<OpenReceiptLine>> OpenReceiptLinesAsync(Guid companyId, Guid partnerId, List<Guid> itemIds)
    {
        if (itemIds.Count == 0) return new();
        var lines = await _db.StockDocumentLines.AsNoTracking()
            .Where(l => itemIds.Contains(l.ItemId) && l.StockDocument!.CompanyId == companyId && l.StockDocument.PartnerId == partnerId
                && l.StockDocument.Type == StockDocumentType.Receipt && l.StockDocument.State == StockDocumentState.Posted)
            .Select(l => new { l.Id, l.ItemId, l.PurchaseOrderLineId, l.UnitCost, l.Quantity, l.StockDocument!.Date, l.StockDocument.PostedAt })
            .ToListAsync();
        if (lines.Count == 0) return new();
        var ids = lines.Select(l => l.Id).ToList();
        var matched = await _db.ReceiptMatches.AsNoTracking().Where(m => ids.Contains(m.ReceiptLineId))
            .GroupBy(m => m.ReceiptLineId).Select(g => new { g.Key, Quantity = g.Sum(m => m.Quantity), Value = g.Sum(m => m.Value) })
            .ToDictionaryAsync(g => g.Key);
        return lines.Select(l => new OpenReceiptLine
        {
            LineId = l.Id, ItemId = l.ItemId, PurchaseOrderLineId = l.PurchaseOrderLineId, UnitCost = l.UnitCost ?? 0m,
            Date = l.Date, PostedAt = l.PostedAt,
            Open = l.Quantity - (matched.TryGetValue(l.Id, out var m) ? m.Quantity : 0m),
            // As the receipt posted it (StockDocumentService: Money(quantity × unit cost)).
            OpenValue = AverageCost.Money(l.Quantity * (l.UnitCost ?? 0m)) - (m?.Value ?? 0m),
        }).Where(l => l.Open > 0).ToList();
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
        b.Lines.Select(l => new BillLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.ExpenseAccountId, l.DiscountPercent, l.ItemId, l.PurchaseOrderLineId, l.UnitName, l.UnitFactor, l.LotNumber, l.ExpiryDate, l.CostCodeId)).ToList(),
        b.InternalNotes,
        b.PriceMode,
        b.WarehouseId,
        b.ProjectId);
}
