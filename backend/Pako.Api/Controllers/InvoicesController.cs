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
using Pako.Domain.Hr;
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
    private readonly NumberSeriesService _numberSeries;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;

    // HR module: every invoice read goes through .VisibleTo(_access), so a partner-scoped staff
    // user gets 404 on another partner's document (never a hint that it exists), and every write
    // naming a partner is refused unless that partner is assigned to them.
    public InvoicesController(
        PakoDbContext db,
        ITaxComputationService taxComputationService,
        IDocumentNumberService documentNumberService,
        NumberSeriesService numberSeries,
        IStringLocalizer<ErrorMessages> localizer,
        CompanyAccessContext access)
    {
        _db = db;
        _taxComputationService = taxComputationService;
        _documentNumberService = documentNumberService;
        _numberSeries = numberSeries;
        _localizer = localizer;
        _access = access;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<InvoiceResponse>>> List(Guid companyId)
    {
        var invoices = await _db.Invoices.AsNoTracking().VisibleTo(_access)
            .Include(i => i.Lines)
            .Where(i => i.CompanyId == companyId)
            .OrderByDescending(i => i.IssueDate)
            .ToListAsync();

        return Ok(invoices.Select(ToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<InvoiceResponse>> Get(Guid companyId, Guid id)
    {
        var invoice = await _db.Invoices.AsNoTracking().VisibleTo(_access)
            .Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);

        if (invoice is null)
        {
            return NotFound();
        }

        return Ok(ToResponse(invoice));
    }

    // A4 (v2 release): there is deliberately no DELETE route on this controller — a posted
    // document can only be corrected by a return or a storno (JournalEntry.Reverse()), never
    // deleted. A genuinely blank Draft (never posted, no number, no journal entry) is the one
    // exception, and even that goes through this dedicated POST action rather than a DELETE verb,
    // so InvoicesControllerTests' "no delete route exists" guarantee stays literally true.
    [HttpPost("{id:guid}/discard")]
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
    public async Task<IActionResult> Discard(Guid companyId, Guid id)
    {
        var invoice = await _db.Invoices.VisibleTo(_access).FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        if (invoice.State != InvoiceState.Draft || invoice.InvoiceNumber is not null || invoice.JournalEntryId is not null)
        {
            return BadRequest(_localizer["InvoiceNotDraftForDiscard"].Value);
        }

        _db.Invoices.Remove(invoice);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    // A5 (v2 release): extracted from Create() so Update()'s Draft-full-replace path can reuse
    // the identical validation — pure extraction, no behavior change (covered by Create()'s own
    // existing tests, re-run after this refactor to confirm). Returns either the built lines +
    // total, or a ready-to-return ActionResult (BadRequest) the caller should return immediately.
    private async Task<(List<InvoiceLine>? Lines, decimal Total, ActionResult? Error)> BuildAndValidateLinesAsync(
        Guid companyId, List<CreateInvoiceLineRequest> requestLines, DocumentType documentType, bool isVatRegistered)
    {
        if (requestLines.Count == 0)
        {
            return (null, 0m, BadRequest(_localizer["InvoiceMustHaveLines"].Value));
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

        var defaultRevenueAccountId = defaults.RevenueAccountId;

        // A down-payment invoice must credit a liability account (deposits aren't earned revenue
        // yet), not the normal Revenue account — forced here regardless of any RevenueAccountId
        // the caller supplies per line, so the accounting can't be steered wrong.
        var depositsAccountId = defaults.CustomerDepositsAccountId;

        // B6: an item with no default of its own falls back to the company's default — chosen
        // over refusing the save, since an item-level override is an optional convenience, not a
        // requirement, and most companies are fine posting every sales line to one revenue
        // account regardless of which item it was.
        var itemIds = requestLines.Where(l => l.ItemId.HasValue).Select(l => l.ItemId!.Value).ToHashSet();
        var itemsById = itemIds.Count == 0
            ? new Dictionary<Guid, Item>()
            : await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id) && i.CompanyId == companyId).ToDictionaryAsync(i => i.Id);

        // docs/INVENTORY_PLAN.md D9: the item's category supplies accounts the item doesn't set.
        var categoryIdsForLines = itemsById.Values.Where(i => i.CategoryId != null).Select(i => i.CategoryId!.Value).Distinct().ToList();
        var categoriesById = categoryIdsForLines.Count == 0
            ? new Dictionary<Guid, Pako.Domain.Inventory.ItemCategory>()
            : await _db.ItemCategories.AsNoTracking().Where(c => categoryIdsForLines.Contains(c.Id)).ToDictionaryAsync(c => c.Id);

        var lines = new List<InvoiceLine>();
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

            // B6: an explicit line tax code wins; otherwise the referenced item's own default,
            // if it has one and set one.
            var taxDefinitionId = line.TaxDefinitionId ?? item?.DefaultTaxDefinitionId;

            // C2: a VAT-registered company must tag every line with a real tax code — the old
            // empty "no tax" option silently posted with no VAT code at all, invisible to the
            // VAT return and the ATK books. A company that isn't VAT-registered still has no
            // VAT mechanics to speak of, so a null TaxDefinitionId stays valid for it.
            if (isVatRegistered && taxDefinitionId is null)
            {
                return (null, 0m, BadRequest(_localizer["TaxCodeRequired"].Value));
            }

            // VAT eligibility: a non-VAT company must not use VAT-mechanism codes (Out/In/Imp/Rc).
            // Kosovo VAT Law Art. 6(8): non-registered persons must not charge VAT.
            // Art. 35(1): only registered persons may deduct input VAT.
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

            // B6: line's own account wins, then the item's default, then the company's —
            // "company fallback, not refuse the save" for an item with no default of its own.
            var revenueAccountId = documentType == DocumentType.DownPayment
                ? depositsAccountId
                : line.RevenueAccountId ?? item?.DefaultRevenueAccountId
                    ?? (item?.CategoryId is { } categoryId ? categoriesById.GetValueOrDefault(categoryId)?.RevenueAccountId : null)
                    ?? defaultRevenueAccountId;
            if (!validAccountIds.Contains(revenueAccountId))
            {
                return (null, 0m, BadRequest(string.Format(_localizer["RevenueAccountNotBelongToCompany"], revenueAccountId)));
            }

            if (StockService.ResolveUnit(item, line.UnitName) is not { } unit)
            {
                return (null, 0m, BadRequest(string.Format(_localizer["LineUnitUnknown"].Value, line.UnitName)));
            }

            total += line.Quantity * line.UnitPrice * (1 - discountPercent / 100m);

            lines.Add(new InvoiceLine
            {
                Id = Guid.NewGuid(),
                Description = line.Description,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice,
                DiscountPercent = discountPercent,
                TaxDefinitionId = taxDefinitionId,
                RevenueAccountId = revenueAccountId,
                ItemId = line.ItemId,
                UnitName = unit.Name,
                UnitFactor = unit.Factor,
                LotNumber = string.IsNullOrWhiteSpace(line.LotNumber) ? null : line.LotNumber.Trim(),
                SalesOrderLineId = line.SalesOrderLineId,
                DeliveryLineId = line.DeliveryLineId
            });
        }

        if (total <= 0)
        {
            return (null, 0m, BadRequest(_localizer["InvoiceMustBePositiveTotal"].Value));
        }

        return (lines, total, null);
    }

    // docs/POS_PLAN.md P6: an invoice line may name the sales order line it bills and the posted
    // delivery line whose goods it bills — both of this customer, for the same item. A delivery
    // line fills in its order line.
    private async Task<ActionResult?> ValidateSalesLinksAsync(Guid companyId, Guid partnerId, DocumentType documentType, List<InvoiceLine> lines)
    {
        var linked = lines.Where(l => l.SalesOrderLineId != null || l.DeliveryLineId != null).ToList();
        if (linked.Count == 0) return null;
        if (documentType is not (DocumentType.Invoice or DocumentType.Proforma)) return BadRequest(_localizer["InvoiceSalesLinkInvalid"].Value);
        var deliveryIds = linked.Where(l => l.DeliveryLineId != null).Select(l => l.DeliveryLineId!.Value).ToList();
        var deliveries = await _db.StockDocumentLines.AsNoTracking()
            .Where(l => deliveryIds.Contains(l.Id) && l.StockDocument!.CompanyId == companyId && l.StockDocument.PartnerId == partnerId
                && l.StockDocument.Type == Pako.Domain.Inventory.StockDocumentType.Delivery
                && l.StockDocument.State == Pako.Domain.Inventory.StockDocumentState.Posted)
            .ToDictionaryAsync(l => l.Id);
        foreach (var line in linked.Where(l => l.DeliveryLineId != null))
        {
            if (!deliveries.TryGetValue(line.DeliveryLineId!.Value, out var delivery) || delivery.ItemId != line.ItemId
                || (line.SalesOrderLineId is { } o && delivery.SalesOrderLineId != o))
            {
                return BadRequest(_localizer["InvoiceSalesLinkInvalid"].Value);
            }
            line.SalesOrderLineId = delivery.SalesOrderLineId;
        }
        var orderIds = linked.Where(l => l.SalesOrderLineId != null).Select(l => l.SalesOrderLineId!.Value).Distinct().ToList();
        var orderLines = await _db.SalesOrderLines.AsNoTracking()
            .Where(l => orderIds.Contains(l.Id) && l.SalesOrder!.CompanyId == companyId && l.SalesOrder.PartnerId == partnerId
                && (l.SalesOrder.State == SalesOrderState.Confirmed || l.SalesOrder.State == SalesOrderState.Closed))
            .ToDictionaryAsync(l => l.Id, l => l.ItemId);
        if (linked.Any(l => l.SalesOrderLineId is { } id && (!orderLines.TryGetValue(id, out var item) || item != l.ItemId)))
        {
            return BadRequest(_localizer["InvoiceSalesLinkInvalid"].Value);
        }
        return null;
    }

    // A line billing a delivery can't bill more than the delivery line sent, less what other posted
    // invoices already billed.
    private async Task CheckDeliveriesNotOverInvoicedAsync(Invoice invoice)
    {
        var byLine = invoice.Lines.Where(l => l.DeliveryLineId != null)
            .GroupBy(l => l.DeliveryLineId!.Value).ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity * l.UnitFactor));
        if (byLine.Count == 0) return;
        var sent = await _db.StockDocumentLines.AsNoTracking().Where(l => byLine.Keys.Contains(l.Id))
            .Select(l => new { l.Id, l.Quantity }).ToDictionaryAsync(l => l.Id, l => l.Quantity);
        var invoiced = await SalesOrderQuantities.InvoicedDeliveriesAsync(_db, byLine.Keys.ToList(), exceptInvoiceId: invoice.Id);
        foreach (var (lineId, quantity) in byLine)
        {
            var open = Math.Max(0m, sent.GetValueOrDefault(lineId) - invoiced.GetValueOrDefault(lineId));
            if (quantity > open)
            {
                var description = invoice.Lines.First(l => l.DeliveryLineId == lineId).Description;
                throw new StockException(string.Format(_localizer["InvoiceOverDelivered"].Value, description, open));
            }
        }
    }

    // Track A (v2 release): a SalesReturn is a correction of a specific prior invoice, unlike
    // CreditNote/DebitNote/DownPayment where OriginalInvoiceId stays optional. Extracted
    // alongside BuildAndValidateLinesAsync for the same reason — Update()'s Draft path reuses it.
    private async Task<ActionResult?> ValidateOriginalInvoiceAsync(Guid companyId, DocumentType documentType, Guid? originalInvoiceId)
    {
        if (documentType == DocumentType.SalesReturn && originalInvoiceId is null)
        {
            return BadRequest(_localizer["OriginalInvoiceRequiredForSalesReturn"].Value);
        }

        if (originalInvoiceId is { } id)
        {
            var originalExists = await _db.Invoices.AsNoTracking().VisibleTo(_access)
                .AnyAsync(i => i.Id == id && i.CompanyId == companyId);
            if (!originalExists)
            {
                return BadRequest(_localizer["OriginalInvoiceNotBelongToCompany"].Value);
            }
        }

        return null;
    }

    [HttpPost]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(InvoiceResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<InvoiceResponse>> Create(Guid companyId, CreateInvoiceRequest request)
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
        if (partner is null || !partner.IsCustomer)
        {
            return BadRequest(_localizer["InvalidCustomerPartner"].Value);
        }

        var (lines, _, linesError) = await BuildAndValidateLinesAsync(companyId, request.Lines, request.DocumentType, company.IsVatRegistered);
        if (linesError is not null)
        {
            return linesError;
        }
        if (await ValidateSalesLinksAsync(companyId, request.PartnerId, request.DocumentType, lines!) is { } linkError)
        {
            return linkError;
        }

        var originalInvoiceError = await ValidateOriginalInvoiceAsync(companyId, request.DocumentType, request.OriginalInvoiceId);
        if (originalInvoiceError is not null)
        {
            return originalInvoiceError;
        }

        if (request.ProjectId is { } projectId && !await _db.Projects.AnyAsync(p => p.Id == projectId && p.CompanyId == companyId))
        {
            return BadRequest(_localizer["ProjectNotFound"].Value);
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
            PriceMode = request.PriceMode,
            // B8: an explicit request value wins; otherwise the partner's own stored default.
            PaymentTermDays = request.PaymentTermDays ?? partner.PaymentTermDays,
            GraceDays = request.GraceDays,
            InternalNotes = request.InternalNotes,
            WarehouseId = request.WarehouseId,
            ProjectId = request.ProjectId,
            Lines = lines!
        };

        // A3 (v2 release): a proforma never posts (see Post()'s rejection below), so unlike every
        // other document type — which numbers only on a successful post — a proforma is numbered
        // right here at creation, off its own PRO-#### series, since creation is the only moment
        // it will ever exist to be numbered. Row-locked the same way posting numbers everything
        // else, to keep the series gapless under concurrent creates. A proforma never posts, so
        // C3's inline-payment request field is meaningless for it — this branch returns before
        // that logic is ever reached.
        if (request.DocumentType == DocumentType.Proforma)
        {
            var proformaTransaction = _db.Database.SupportsRowLocking()
                ? await _db.Database.BeginTransactionAsync()
                : null;
            try
            {
                if (proformaTransaction is not null)
                {
                    await _db.Database.ExecuteSqlInterpolatedAsync(
                        $"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
                }

                var trackedCompany = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
                if (trackedCompany is null)
                {
                    return NotFound();
                }

                invoice.InvoiceNumber = await _numberSeries.ReserveNextAsync(companyId, "Proforma", invoice.IssueDate);

                _db.Invoices.Add(invoice);
                await _db.SaveChangesAsync();

                if (proformaTransaction is not null)
                {
                    await proformaTransaction.CommitAsync();
                }

                return StatusCode(StatusCodes.Status201Created, ToResponse(invoice));
            }
            finally
            {
                if (proformaTransaction is not null)
                {
                    await proformaTransaction.DisposeAsync();
                }
            }
        }

        if (request.Payment is null)
        {
            _db.Invoices.Add(invoice);
            await _db.SaveChangesAsync();

            return StatusCode(StatusCodes.Status201Created, ToResponse(invoice));
        }

        // C3: "the €300 invoice paid €200 in cash on the spot... the document is never briefly
        // unpaid." Posts the invoice and records the payment in one transaction — the Draft
        // invoice built above never gets its own SaveChanges; either everything below succeeds
        // (invoice + its journal entry + the settlement entry + the reconciliation all land
        // together) or nothing does, including the invoice row itself.
        var paymentMethod = await _db.PaymentMethods.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == request.Payment.PaymentMethodId && m.CompanyId == companyId);
        // Money actually received: a voucher, gift card or on-account "payment" would mark the
        // invoice paid without collecting anything (docs/POS_PLAN.md tenders are till-only).
        if (paymentMethod is null || paymentMethod.Kind is not (PaymentMethodKind.Cash or PaymentMethodKind.Bank or PaymentMethodKind.Card))
        {
            return BadRequest(_localizer["InvalidPaymentMethod"].Value);
        }

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

            var trackedCompany = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (trackedCompany is null)
            {
                return NotFound();
            }

            // B8: lock the partner row to serialize concurrent credit-limit checks.
            if (transaction is not null)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM partners WHERE \"Id\" = {invoice.PartnerId} FOR UPDATE");
            }

            _db.Invoices.Add(invoice);

            var postError = await PostDraftInvoiceAsync(trackedCompany, invoice);
            if (postError is not null)
            {
                return postError;
            }

            await _db.SaveChangesAsync();

            var outcome = await TryRecordPaymentAsync(
                trackedCompany, invoice, request.Payment.Amount, paymentMethod.LedgerAccountId,
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

    // A5 (v2 release): Draft = fully editable — full replace, reusing Create()'s own validation
    // (BuildAndValidateLinesAsync/ValidateOriginalInvoiceAsync) applied to the existing tracked
    // entity instead of a new one. Old lines are explicitly removed and replaced rather than
    // relying on EF's implicit orphan-delete for a cleared collection nav. No audit row — Draft
    // carries no accounting weight yet, so there's nothing to audit (see EditPosted below for the
    // Posted-only, audited path, which this endpoint deliberately cannot reach: a Posted document
    // 400s here with a message pointing at the right endpoint, rather than silently no-opping).
    [HttpPut("{id:guid}")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<InvoiceResponse>> Update(Guid companyId, Guid id, UpdateInvoiceRequest request)
    {
        var invoice = await _db.Invoices.VisibleTo(_access).Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        if (invoice.State == InvoiceState.Cancelled)
        {
            return BadRequest(_localizer["InvoiceNotEditableWhenCancelled"].Value);
        }

        if (invoice.State == InvoiceState.Posted)
        {
            return BadRequest(_localizer["InvoiceOnlyDueDateOrNotesEditableAfterPosting"].Value);
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
        if (partner is null || !partner.IsCustomer)
        {
            return BadRequest(_localizer["InvalidCustomerPartner"].Value);
        }

        var (lines, _, linesError) = await BuildAndValidateLinesAsync(companyId, request.Lines, request.DocumentType, company.IsVatRegistered);
        if (linesError is not null)
        {
            return linesError;
        }
        if (await ValidateSalesLinksAsync(companyId, request.PartnerId, request.DocumentType, lines!) is { } linkError)
        {
            return linkError;
        }

        var originalInvoiceError = await ValidateOriginalInvoiceAsync(companyId, request.DocumentType, request.OriginalInvoiceId);
        if (originalInvoiceError is not null)
        {
            return originalInvoiceError;
        }

        // Managed directly via the InvoiceLines DbSet rather than through the Lines collection
        // navigation — explicit Remove for the old rows, explicit InvoiceId assignment + Add for
        // the new ones. Relying on collection-navigation fixup (Clear/replace + EF's implicit
        // required-FK orphan deletion) hit a DbUpdateConcurrencyException on the InMemory
        // provider; this sidesteps that ambiguity entirely.
        _db.InvoiceLines.RemoveRange(invoice.Lines);
        foreach (var line in lines!)
        {
            line.InvoiceId = invoice.Id;
        }
        _db.InvoiceLines.AddRange(lines);

        if (request.ProjectId is { } projectId && !await _db.Projects.AnyAsync(p => p.Id == projectId && p.CompanyId == companyId))
        {
            return BadRequest(_localizer["ProjectNotFound"].Value);
        }

        invoice.PartnerId = request.PartnerId;
        invoice.IssueDate = request.IssueDate;
        invoice.DueDate = request.DueDate;
        invoice.DocumentType = request.DocumentType;
        invoice.OriginalInvoiceId = request.OriginalInvoiceId;
        invoice.InternalNotes = request.InternalNotes;
        invoice.WarehouseId = request.WarehouseId;
        invoice.ProjectId = request.ProjectId;

        await _db.SaveChangesAsync();

        invoice.Lines = lines;
        return Ok(ToResponse(invoice));
    }

    // A5 (v2 release): the entire editable surface of a Posted invoice — see
    // EditPostedInvoiceRequest's doc comment. Writes one DocumentEditAudit row per call, whichever
    // of DueDate/InternalNotes actually changed. Reaches PakoDbContext's
    // OnlyDueDateOrInternalNotesChanged carve-out on SaveChangesAsync — the backstop half of this
    // guard, since this action itself never touches any other field to begin with.
    [HttpPatch("{id:guid}")]
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
    public async Task<ActionResult<InvoiceResponse>> EditPosted(Guid companyId, Guid id, EditPostedInvoiceRequest request)
    {
        var invoice = await _db.Invoices.VisibleTo(_access).Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        if (invoice.State != InvoiceState.Posted)
        {
            return BadRequest(_localizer["InvoiceOnlyDueDateOrNotesEditableAfterPosting"].Value);
        }

        var dueDateChanged = invoice.DueDate != request.DueDate;
        var notesChanged = invoice.InternalNotes != request.InternalNotes;

        if (dueDateChanged || notesChanged)
        {
            _db.DocumentEditAudits.Add(new DocumentEditAudit
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                DocumentId = invoice.Id,
                UserId = CurrentUserId,
                OldDueDate = dueDateChanged ? invoice.DueDate : null,
                NewDueDate = dueDateChanged ? request.DueDate : null,
                OldInternalNotes = notesChanged ? invoice.InternalNotes : null,
                NewInternalNotes = notesChanged ? request.InternalNotes : null
            });

            invoice.DueDate = request.DueDate;
            invoice.InternalNotes = request.InternalNotes;

            await _db.SaveChangesAsync();
        }

        return Ok(ToResponse(invoice));
    }

    [HttpGet("{id:guid}/balance")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<DocumentBalanceResponse>> Balance(Guid companyId, Guid id)
    {
        var invoice = await _db.Invoices.AsNoTracking().VisibleTo(_access).FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        return Ok(await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId, invoice.DocumentType, invoice.PartnerId));
    }

    // Atomic replacement for the client's old draft-journal-entry -> post -> reconcile 3-call
    // sequence: builds the settlement entry, posts it, and reconciles it against this invoice in
    // one transaction (Postgres only — see SupportsRowLocking), so a mid-sequence failure (e.g. an
    // invalid cashOrBankAccountId, or the reconciliation itself failing Fix 1's line-capacity
    // check) leaves nothing persisted instead of an orphaned Posted journal entry.
    [HttpPost("{id:guid}/record-payment")]
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
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

        var invoice = await _db.Invoices.AsNoTracking().VisibleTo(_access).FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
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

        var transaction = _db.Database.SupportsRowLocking()
            ? await _db.Database.BeginTransactionAsync()
            : null;
        try
        {
            var outcome = await TryRecordPaymentAsync(company, invoice, request.Amount, cashOrBankAccount.Id, request.Date);
            if (outcome.Error is not null)
            {
                return outcome.Error;
            }

            var isRefundPayment = invoice.DocumentType == DocumentType.SalesReturn;
            AuditController.Stage(_db, companyId, "Invoice", id.ToString(),
                isRefundPayment ? "Refund" : "Payment",
                CurrentUserId.ToString(), $"Amount={request.Amount}");

            await _db.SaveChangesAsync();

            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }

            var balance = await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId, invoice.DocumentType, invoice.PartnerId);
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

    // C3: the settlement-entry-plus-reconcile half of "record a payment," shared by RecordPayment
    // above and Create's optional inline-payment branch below (which posts the invoice itself via
    // PostDraftInvoiceAsync first, then calls this against the freshly-posted invoice). Does its
    // own intermediate SaveChanges after the settlement entry (ReconciliationCreator.TryCreateAsync
    // needs the settlement line to actually exist in the database to query it) but leaves the
    // final SaveChanges/transaction commit to the caller.
    private async Task<RecordPaymentOutcome> TryRecordPaymentAsync(
        Company company, Invoice invoice, decimal amount, Guid cashOrBankAccountId, DateOnly date)
    {
        var receivableAccountId = await GetReceivableAccountIdAsync(company.Id, invoice.PartnerId);
        if (receivableAccountId == Guid.Empty)
        {
            return new RecordPaymentOutcome(BadRequest(_localizer["NoReceivableAccount"].Value), null);
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

        // A Sales Return or Credit Note is a credit document — "recording a payment" against it
        // means issuing a refund: cash goes OUT (Credit Cash) and the customer's credit balance is
        // cleared (Debit AR). Normal invoices are the reverse: cash IN (Debit Cash), receivable
        // cleared (Credit AR).
        var isCreditDocument = invoice.DocumentType is DocumentType.CreditNote or DocumentType.SalesReturn;
        var settlementEntry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = journal.Id,
            Date = date,
            Reference = isCreditDocument
                ? $"Refund for {invoice.InvoiceNumber}"
                : $"Payment for {invoice.InvoiceNumber}",
            Lines =
            {
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = cashOrBankAccountId,
                    Debit = isCreditDocument ? 0m : amount,
                    Credit = isCreditDocument ? amount : 0m },
                new JournalEntryLine { Id = Guid.NewGuid(), AccountId = receivableAccountId, PartnerId = invoice.PartnerId,
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

        var settlementLineId = settlementEntry.Lines.Single(l => l.AccountId == receivableAccountId).Id;
        var result = await ReconciliationCreator.TryCreateAsync(_db, company.Id, invoice.Id, null, settlementLineId, amount);
        if (result.Status == ReconciliationCreationStatus.NotFound)
        {
            return new RecordPaymentOutcome(NotFound(), null);
        }

        if (result.Status == ReconciliationCreationStatus.ValidationFailed)
        {
            return new RecordPaymentOutcome(BadRequest(result.Error), null);
        }

        AuditController.Stage(_db, company.Id, "Invoice", invoice.Id.ToString(),
            isCreditDocument ? "Refund" : "Payment", CurrentUserId.ToString(),
            $"Amount: {amount}, Account: {cashOrBankAccountId}");

        return new RecordPaymentOutcome(null, result.Reconciliation);
    }

    // Applies a Posted credit note against this invoice by feeding the credit note's own AR line
    // to ReconciliationCreator as the settlement line, instead of creating a new one — the same
    // double-spend/over-consumption protection Fix 1 built for record-payment applies here for
    // free (see CLAUDE.md's backend fixes pass), and the partner-match check in
    // ReconciliationValidator already covers "same partner as the target invoice."
    [HttpPost("{id:guid}/apply-credit-note")]
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
    [ProducesResponseType(typeof(ApplyCreditNoteResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ApplyCreditNoteResponse>> ApplyCreditNote(Guid companyId, Guid id, ApplyCreditNoteRequest request)
    {
        if (request.Amount <= 0)
        {
            return BadRequest(_localizer["AmountMustBePositive"].Value);
        }

        var invoice = await _db.Invoices.AsNoTracking().VisibleTo(_access).FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        // The credit note must be visible too — otherwise its id becomes an existence oracle.
        var creditNote = await _db.Invoices.AsNoTracking().VisibleTo(_access)
            .FirstOrDefaultAsync(i => i.Id == request.CreditNoteId && i.CompanyId == companyId);
        if (creditNote is null)
        {
            return NotFound();
        }

        if (creditNote.DocumentType is not (DocumentType.CreditNote or DocumentType.SalesReturn) || creditNote.State != InvoiceState.Posted)
        {
            return BadRequest(_localizer["InvalidCreditNote"].Value);
        }

        var receivableAccountId = await GetReceivableAccountIdAsync(companyId, invoice.PartnerId);

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

            var balance = await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId, invoice.DocumentType, invoice.PartnerId);
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
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
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

        var invoice = await _db.Invoices.AsNoTracking().VisibleTo(_access).FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null)
        {
            return NotFound();
        }

        var downPayment = await _db.Invoices.AsNoTracking().VisibleTo(_access)
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

        // B8: the down-payment invoice's own AR line was posted against ITS partner's resolved
        // receivable account (partner override or company default) — look it up there, not the
        // company default alone, so this still finds the line when an override is in play.
        var receivableAccountId = await GetReceivableAccountIdAsync(companyId, downPayment.PartnerId);
        var depositsAccountId = defaults.CustomerDepositsAccountId;
        var revenueAccountId = defaults.RevenueAccountId;

        // B9: the reclassification entry (Debit Customer Deposits / Credit Revenue) is sales-side
        // revenue recognition, same as the invoice it's reclassifying — Sale journal.
        var journal = await JournalResolver.GetAsync(_db, companyId, JournalType.Sale);
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

            var balance = await ComputeBalanceAsync(companyId, id, invoice.JournalEntryId, invoice.DocumentType, invoice.PartnerId);
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

    private async Task<DocumentBalanceResponse> ComputeBalanceAsync(Guid companyId, Guid invoiceId, Guid? journalEntryId, DocumentType documentType, Guid? partnerId = null)
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
            var receivableAccountId = await GetReceivableAccountIdAsync(companyId, partnerId);

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

        // Source documents (CreditNote/SalesReturn/DownPayment) can be reconciled two ways:
        // (a) their control line used as a settlement line against another invoice (ApplyCreditNote)
        // (b) a cash refund reconciled directly against this document (RecordPayment)
        // Sum both patterns to get the full reconciled amount.
        var reconciledViaControlLine = isSourceDocument && controlLineId is { } lineId
            ? await ReconciliationCreator.SumReconciledForLineAsync(_db, lineId)
            : 0m;
        var reconciledViaDocument = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId == invoiceId).SumAsync(r => r.Amount);
        var reconciled = isSourceDocument
            ? reconciledViaControlLine + reconciledViaDocument
            : reconciledViaDocument;

        return new DocumentBalanceResponse(total, reconciled, total - reconciled);
    }

    private static ReconciliationResponse ToReconciliationResponse(Reconciliation r) =>
        new(r.Id, r.InvoiceId, r.BillId, r.JournalEntryLineId, r.Amount, r.ReconciledAt);

    private Task<CompanyAccountDefaults?> GetAccountDefaultsAsync(Guid companyId) =>
        _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);

    // B8: partner's own ReceivableAccountId wins when set and the caller has a partner to ask
    // about (every call site that posts, pays, or reads a specific document does); the company's
    // default otherwise — same override-then-fallback chain B6 established for Item defaults.
    private async Task<Guid> GetReceivableAccountIdAsync(Guid companyId, Guid? partnerId = null)
    {
        if (partnerId is { } id)
        {
            var partnerAccountId = await _db.Partners.AsNoTracking()
                .Where(p => p.Id == id && p.CompanyId == companyId)
                .Select(p => p.ReceivableAccountId)
                .FirstOrDefaultAsync();
            if (partnerAccountId is { } paId)
            {
                return paId;
            }
        }

        return (await GetAccountDefaultsAsync(companyId))?.ReceivableAccountId ?? Guid.Empty;
    }

    [HttpGet("{id:guid}/post-preview")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<PostingPreviewResponse>> PostPreview(Guid companyId, Guid id)
    {
        var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == companyId);
        if (company is null) return NotFound();

        var invoice = await _db.Invoices.AsNoTracking().Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
        if (invoice is null) return NotFound();

        var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == invoice.PartnerId);
        var journal = await JournalResolver.GetAsync(_db, company.Id, JournalType.Sale);
        if (journal is null) return BadRequest(_localizer["NoJournalToPost"].Value);

        var defaults = await GetAccountDefaultsAsync(company.Id);
        if (defaults is null) return BadRequest(_localizer["NoAccountDefaults"].Value);

        var receivableAccountId = partner?.ReceivableAccountId ?? defaults.ReceivableAccountId;
        var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
            .Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == company.Id)
            .ToDictionaryAsync(t => t.Id);

        // Use a clone of the company to avoid mutating the tracked entity's number counter
        var previewCompany = new Company
        {
            Id = company.Id, Name = company.Name, FirmId = company.FirmId,
            AccountingLockDate = company.AccountingLockDate, TaxLockDate = company.TaxLockDate,
            SaleLockDate = company.SaleLockDate, PurchaseLockDate = company.PurchaseLockDate,
            HardLockDate = company.HardLockDate,
            NextInvoiceNumber = company.NextInvoiceNumber, NextCreditNoteNumber = company.NextCreditNoteNumber,
            NextDebitNoteNumber = company.NextDebitNoteNumber, NextSalesReturnNumber = company.NextSalesReturnNumber,
            NextDownPaymentNumber = company.NextDownPaymentNumber, NextProformaNumber = company.NextProformaNumber,
            IsVatRegistered = company.IsVatRegistered, AllowNumberOverride = company.AllowNumberOverride,
            EnabledProfiles = company.EnabledProfiles, FunctionalCurrency = company.FunctionalCurrency,
        };

        JournalEntry journalEntry;
        try
        {
            journalEntry = invoice.Post(
                previewCompany, journal.Id, receivableAccountId, _taxComputationService, taxDefinitionsById,
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
    [RequireCompanyAccess(module: AccessModule.Sales, approve: true)]
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

            var invoice = await _db.Invoices.VisibleTo(_access).Include(i => i.Lines)
                .FirstOrDefaultAsync(i => i.Id == id && i.CompanyId == companyId);
            if (invoice is null)
            {
                return NotFound();
            }

            // B8: lock the partner row to serialize concurrent credit-limit checks for the
            // same partner. Inside the same transaction that already locks the company row.
            if (transaction is not null)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM partners WHERE \"Id\" = {invoice.PartnerId} FOR UPDATE");
            }

            var postError = await PostDraftInvoiceAsync(company, invoice);
            if (postError is not null)
            {
                return postError;
            }

            AuditController.Stage(_db, companyId, "Invoice", invoice.Id.ToString(),
                "Post", CurrentUserId.ToString(), $"Number: {invoice.InvoiceNumber}, Type: {invoice.DocumentType}");

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

    // A3 (v2 release): a proforma is an offer, never posted (see PostDraftInvoiceAsync's rejection
    // below) — converting creates a new, independent Draft invoice copying the proforma's partner
    // and every line verbatim. The link back reuses OriginalInvoiceId (already means "the other
    // document this one relates to") rather than a dedicated column, to avoid a migration for
    // this alone; the proforma itself is left as-is, untouched, still available for reference.
    [HttpPost("{id:guid}/convert-to-invoice")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(InvoiceResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<InvoiceResponse>> ConvertToInvoice(Guid companyId, Guid id)
    {
        var proforma = await _db.Invoices.AsNoTracking().VisibleTo(_access).Include(i => i.Lines)
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
                RevenueAccountId = l.RevenueAccountId,
                ItemId = l.ItemId,
                UnitName = l.UnitName,
                UnitFactor = l.UnitFactor,
                LotNumber = l.LotNumber,
                SalesOrderLineId = l.SalesOrderLineId,
                DeliveryLineId = l.DeliveryLineId
            }).ToList()
        };

        _db.Invoices.Add(invoice);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, ToResponse(invoice));
    }

    // C3: the actual "turn a Draft invoice into a Posted one" logic, shared by Post above and
    // Create's optional inline-payment branch below — extracted so this repo's most dangerous
    // code path (numbering, the R07/R08/R09 posting-rule checks, JournalEntry.Post itself) exists
    // exactly once. Adds the resulting JournalEntry to the context but does not SaveChanges or
    // manage a transaction — the caller owns both, since Post's own row-lock scope differs from
    // Create's (Create locks before the invoice even exists as a row). Also absorbs Track A's
    // Proforma-rejection and SalesReturn-amount checks, which were originally inline in Post()
    // before this extraction existed — both apply regardless of which caller reaches this method.
    private async Task<ActionResult?> PostDraftInvoiceAsync(Company company, Invoice invoice)
    {
        // A3 (v2 release): a proforma is an offer, not a legal invoice — it must never post a
        // journal entry, consume a fiscal invoice number, or appear in the VAT return. Checked
        // as early as possible (right after we know the document type) so nothing further below
        // ever runs for a proforma.
        if (invoice.DocumentType == DocumentType.Proforma)
        {
            return BadRequest(_localizer["ProformaCannotBePosted"].Value);
        }

        var partner = await _db.Partners.AsNoTracking().FirstOrDefaultAsync(p => p.Id == invoice.PartnerId);

        // Credit limit enforcement: only for documents that increase AR (invoices, debit notes,
        // down-payments), not for returns/credit notes which decrease it.
        if (partner?.CreditLimit is { } limit
            && invoice.DocumentType is DocumentType.Invoice or DocumentType.DebitNote or DocumentType.DownPayment)
        {
            var receivableAccountId2 = partner.ReceivableAccountId
                ?? (await GetAccountDefaultsAsync(company.Id))?.ReceivableAccountId ?? Guid.Empty;
            // Net AR for this partner across all posted entries = current exposure.
            // Debits on AR = invoices posted; credits on AR = payments received + credit notes applied.
            var currentExposure = await _db.JournalEntryLines.AsNoTracking()
                .Include(l => l.JournalEntry)
                .Where(l => l.JournalEntry!.CompanyId == company.Id
                    && l.JournalEntry.State == JournalEntryState.Posted
                    && l.AccountId == receivableAccountId2
                    && l.PartnerId == invoice.PartnerId)
                .SumAsync(l => l.Debit - l.Credit);
            if (currentExposure < 0) currentExposure = 0;

            var invoiceTotal = invoice.Lines.Sum(l => l.Quantity * l.UnitPrice);
            if (currentExposure + invoiceTotal > limit)
            {
                return BadRequest(_localizer["CreditLimitExceeded"].Value);
            }
        }

        // B9: every invoice/credit-note/sales-return/down-payment posts to the Sale journal.
        var journal = await JournalResolver.GetAsync(_db, company.Id, JournalType.Sale);
        if (journal is null)
        {
            return BadRequest(_localizer["NoJournalToPost"].Value);
        }

        var defaults = await GetAccountDefaultsAsync(company.Id);
        if (defaults is null)
        {
            return BadRequest(_localizer["NoAccountDefaults"].Value);
        }

        // B8: the partner's own ReceivableAccountId, if set, wins over the company default —
        // used for every receivable-account reference in this method from here on, so a document
        // for a partner with an override and a document for one without post to, and are found
        // against, the correct account either way.
        var receivableAccountId = partner?.ReceivableAccountId ?? defaults.ReceivableAccountId;
        if (receivableAccountId == Guid.Empty)
        {
            return BadRequest(_localizer["NoReceivableAccount"].Value);
        }

        var taxDefinitionsById = await _db.TaxDefinitions.AsNoTracking()
            .Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == company.Id)
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
                PostingRuleValidator.ValidateVatCounterpartyTaxNumber(taxDef.Code, invoice.PartnerId, partner?.IsVatRegistered ?? false, partner?.TaxNumber, partner?.FiscalNumber);
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
            journalEntry = invoice.Post(
                effectiveCompany, journal.Id, receivableAccountId, _taxComputationService, taxDefinitionsById,
                defaults.ReverseChargeInputVatAccountId, defaults.ReverseChargeOutputVatAccountId);
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException or
            HardLockDateViolationException or
            SaleLockDateViolationException or
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

            if (_db.Database.SupportsRowLocking())
            {
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT \"Id\" FROM invoices WHERE \"Id\" = {originalInvoiceId} FOR UPDATE");
            }

            var original = await _db.Invoices.AsNoTracking()
                .FirstOrDefaultAsync(i => i.Id == originalInvoiceId && i.CompanyId == company.Id);
            if (original is null || original.State != InvoiceState.Posted)
            {
                return BadRequest(_localizer["OriginalInvoiceMustBePostedForReturn"].Value);
            }

            var originalTotal = original.JournalEntryId is { } originalJournalEntryId
                ? await _db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == originalJournalEntryId && l.AccountId == receivableAccountId)
                    .SumAsync(l => l.Debit)
                : 0m;

            var otherReturnJournalEntryIds = await _db.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == company.Id && i.OriginalInvoiceId == originalInvoiceId &&
                    i.DocumentType == DocumentType.SalesReturn && i.State == InvoiceState.Posted && i.Id != invoice.Id)
                .Select(i => i.JournalEntryId)
                .ToListAsync();
            var alreadyReturned = otherReturnJournalEntryIds.Count == 0
                ? 0m
                : await _db.JournalEntryLines.AsNoTracking()
                    .Where(l => otherReturnJournalEntryIds.Contains(l.JournalEntryId) && l.AccountId == receivableAccountId)
                    .SumAsync(l => l.Credit);

            var thisReturnAmount = journalEntry.Lines.Single(l => l.AccountId == receivableAccountId).Credit;

            if (alreadyReturned + thisReturnAmount > originalTotal)
            {
                var remaining = originalTotal - alreadyReturned;
                return BadRequest(string.Format(_localizer["SalesReturnExceedsRemainingOriginalAmount"], thisReturnAmount, remaining));
            }
        }

        // B8: credit limit enforcement — only for documents that increase the receivable
        // (Invoice, DebitNote). CreditNote/SalesReturn/DownPayment reduce or are neutral.
        if (partner?.CreditLimit is { } creditLimit &&
            invoice.DocumentType is DocumentType.Invoice or DocumentType.DebitNote)
        {
            var newAmount = journalEntry.Lines
                .Where(l => l.AccountId == receivableAccountId)
                .Sum(l => l.Debit);
            var currentOutstanding = await GetPartnerOutstandingAsync(company.Id, invoice.PartnerId);
            var available = creditLimit - currentOutstanding;
            if (currentOutstanding + newAmount > creditLimit)
            {
                return BadRequest(string.Format(
                    _localizer["CreditLimitExceeded"].Value,
                    available, newAmount));
            }
        }

        // docs/INVENTORY_PLAN.md §5.3: stock-tracked goods leave stock (invoice) or come back (sales
        // return), and cost of goods sold is posted in the invoice's own entry. A refusal (not enough
        // stock under Block) stops the posting before anything is saved.
        StockService.StockPosting? stockPosting = null;
        if (invoice.DocumentType is DocumentType.Invoice or DocumentType.SalesReturn)
        {
            try
            {
                if (invoice.DocumentType == DocumentType.Invoice) await CheckDeliveriesNotOverInvoicedAsync(invoice);
                stockPosting = await PostInvoiceStockAsync(company, invoice, journalEntry);
            }
            catch (StockException ex)
            {
                return BadRequest(ex.Message);
            }
        }

        // B1: numbering from NumberSeries table, row-locked (gapless). Falls back to the old
        // Company counter via IDocumentNumberService on InMemory (tests).
        var docTypeKey = NumberSeriesService.DocumentTypeKey(invoice.DocumentType);
        invoice.InvoiceNumber = await _numberSeries.ReserveNextAsync(company.Id, docTypeKey, invoice.IssueDate);
        foreach (var outcome in stockPosting?.Moves ?? [])
        {
            outcome.Move.Reference = invoice.InvoiceNumber;
        }
        journalEntry.Reference = invoice.InvoiceNumber;

        journalEntry.PostedByUserId = CurrentUserId;
        journalEntry.SourceDocumentId = invoice.Id;
        // docs/ERP_VERTICALS_PLAN.md: revenue (and the cost of goods it sold) carries the project.
        if (invoice.ProjectId is { } invoiceProject)
        {
            var projectAccounts = invoice.Lines.Select(l => l.RevenueAccountId).ToHashSet();
            foreach (var line in journalEntry.Lines.Where(l => projectAccounts.Contains(l.AccountId) || l.Description == _localizer["StockCostOfGoodsSold"].Value))
            {
                line.ProjectId = invoiceProject;
            }
        }
        journalEntry.SequenceNumber = JournalSequencer.ReserveNext(journal);

        _db.JournalEntries.Add(journalEntry);
        return null;
    }

    private async Task<StockService.StockPosting?> PostInvoiceStockAsync(Company company, Invoice invoice, JournalEntry journalEntry)
    {
        var stock = new StockService(_db, _localizer);
        var tracked = await stock.TrackedItemsAsync(company.Id, invoice.Lines.Select(l => l.ItemId));
        if (tracked.Count == 0) return null;
        var accounts = await stock.AccountsForAsync(company.Id, tracked.Values);
        var location = await stock.DocumentLocationAsync(company.Id, invoice.WarehouseId);
        var customer = await stock.VirtualLocationAsync(company.Id, Pako.Domain.Inventory.LocationUsage.Customer);
        var isReturn = invoice.DocumentType == DocumentType.SalesReturn;

        // D13: returned goods come back at what they cost when the original invoice sold them —
        // unless the sale took them below zero: that issue was valued at the old average (often 0)
        // and its real cost was booked later on the covering receipt, so the return comes back at
        // the current average instead.
        var originalUnitCost = new Dictionary<Guid, decimal>();
        if (isReturn && invoice.OriginalInvoiceId is { } originalId)
        {
            originalUnitCost = (await _db.StockMoves.AsNoTracking()
                    .Where(m => m.SourceType == Pako.Domain.Inventory.StockMoveSource.Invoice && m.SourceId == originalId
                        && m.Kind == Pako.Domain.Inventory.StockMoveKind.Issue && m.Quantity > 0)
                    .GroupBy(m => m.ItemId)
                    .Select(g => new { g.Key, Value = g.Sum(m => m.Value), Quantity = g.Sum(m => m.Quantity), BelowZero = g.Any(m => m.QtyAfter < 0) })
                    .ToListAsync())
                .Where(g => !g.BelowZero)
                .ToDictionary(g => g.Key, g => g.Value / g.Quantity);
            // docs/POS_PLAN.md P6: goods the original invoice billed from delivery notes left stock on
            // those deliveries.
            var deliveryLineIds = await _db.InvoiceLines.AsNoTracking()
                .Where(l => l.InvoiceId == originalId && l.DeliveryLineId != null).Select(l => l.DeliveryLineId!.Value).ToListAsync();
            if (deliveryLineIds.Count > 0)
            {
                var delivered = (await _db.StockMoves.AsNoTracking()
                        .Where(m => m.SourceType == Pako.Domain.Inventory.StockMoveSource.StockDocument && m.SourceLineId != null
                            && deliveryLineIds.Contains(m.SourceLineId.Value) && m.Kind == Pako.Domain.Inventory.StockMoveKind.Issue && m.Quantity > 0)
                        .GroupBy(m => m.ItemId)
                        .Select(g => new { g.Key, Value = g.Sum(m => m.Value), Quantity = g.Sum(m => m.Quantity), BelowZero = g.Any(m => m.QtyAfter < 0) })
                        .ToListAsync())
                    .Where(g => !g.BelowZero);
                foreach (var g in delivered) originalUnitCost.TryAdd(g.Key, g.Value / g.Quantity);
            }
        }

        // §12 P8: returned goods go back into the lot they were sold from, unless the line names one.
        var originalLots = new Dictionary<Guid, string>();
        if (isReturn && invoice.OriginalInvoiceId is { } soldOn)
        {
            originalLots = (await (from m in _db.StockMoves.AsNoTracking()
                                   join ml in _db.StockMoveLots.AsNoTracking() on m.Id equals ml.StockMoveId
                                   join lot in _db.Lots.AsNoTracking() on ml.LotId equals lot.Id
                                   where m.SourceType == Pako.Domain.Inventory.StockMoveSource.Invoice && m.SourceId == soldOn
                                   select new { m.ItemId, lot.Number, lot.ExpiryDate, lot.CreatedAt }).ToListAsync())
                // The lot the sale took from first: earliest expiry, as the sale allocated (FEFO).
                .GroupBy(x => x.ItemId).ToDictionary(g => g.Key, g => g
                    .OrderBy(x => x.ExpiryDate ?? DateOnly.MaxValue).ThenBy(x => x.CreatedAt).ThenBy(x => x.Number).First().Number);
        }

        var requests = new List<StockService.MoveRequest>();
        // docs/POS_PLAN.md P6: a line billing a delivery moves nothing — the delivery sent the goods.
        foreach (var line in invoice.Lines.Where(l => l.ItemId is { } id && tracked.ContainsKey(id) && l.Quantity > 0 && l.DeliveryLineId == null))
        {
            var itemId = line.ItemId!.Value;
            // §12 P7: stock moves in base units.
            var quantity = line.Quantity * line.UnitFactor;
            requests.Add(isReturn
                ? new StockService.MoveRequest(itemId, Pako.Domain.Inventory.StockMoveKind.Receipt, customer.Id, location.Id, quantity,
                    originalUnitCost.TryGetValue(itemId, out var unit) ? Pako.Domain.Inventory.AverageCost.Money(unit * quantity) : null, line.Id,
                    line.LotNumber ?? originalLots.GetValueOrDefault(itemId))
                : new StockService.MoveRequest(itemId, Pako.Domain.Inventory.StockMoveKind.Issue, location.Id, customer.Id, quantity, SourceLineId: line.Id,
                    LotNumber: line.LotNumber));
        }

        var posting = await stock.ApplyAsync(company.Id, invoice.IssueDate, Pako.Domain.Inventory.StockMoveSource.Invoice, invoice.Id, null, requests);
        var cogsLabel = _localizer[isReturn ? "StockGoodsReturned" : "StockCostOfGoodsSold"].Value;
        foreach (var outcome in posting.Moves)
        {
            var a = accounts[outcome.Request.ItemId];
            if (isReturn) StockService.AddPair(journalEntry, a.InventoryAccountId, a.CogsAccountId, outcome.Value, cogsLabel);
            else StockService.AddPair(journalEntry, a.CogsAccountId, a.InventoryAccountId, outcome.Value, cogsLabel);
        }
        StockService.AddCorrections(journalEntry, posting, accounts,
            posting.Moves.Select(m => (m.Request.ItemId, m.Correction)), _localizer["StockCostCorrection"].Value);
        return posting;
    }

    // B8: total outstanding receivables for a partner across all posted invoices in a company.
    // Used by the credit limit check on posting and by the credit-exposure endpoint.
    // Outstanding = sum of receivable-account debits (invoices) minus credits (credit notes /
    // sales returns) across all posted invoice journal entries, minus all reconciled amounts.
    internal async Task<decimal> GetPartnerOutstandingAsync(Guid companyId, Guid partnerId)
    {
        var receivableAccountId = await GetReceivableAccountIdAsync(companyId, partnerId);
        if (receivableAccountId == Guid.Empty) return 0m;

        // All posted invoices for this partner
        var postedInvoices = await _db.Invoices.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.PartnerId == partnerId && i.State == InvoiceState.Posted)
            .Select(i => new { i.Id, i.JournalEntryId })
            .ToListAsync();

        if (postedInvoices.Count == 0) return 0m;

        var journalEntryIds = postedInvoices
            .Where(i => i.JournalEntryId.HasValue)
            .Select(i => i.JournalEntryId!.Value)
            .ToList();

        // Net receivable = sum(Debit) - sum(Credit) on the receivable account across all
        // posted invoice journal entries for this partner.
        var netReceivable = journalEntryIds.Count == 0
            ? 0m
            : await _db.JournalEntryLines.AsNoTracking()
                .Where(l => journalEntryIds.Contains(l.JournalEntryId) && l.AccountId == receivableAccountId)
                .SumAsync(l => l.Debit - l.Credit);

        // Total reconciled across all those invoices (payments, applied credit notes, etc.)
        var invoiceIds = postedInvoices.Select(i => i.Id).ToList();
        var totalReconciled = await _db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId.HasValue && invoiceIds.Contains(r.InvoiceId.Value))
            .SumAsync(r => r.Amount);

        return netReceivable - totalReconciled;
    }

    [HttpGet("partner/{partnerId:guid}/credit-exposure")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<CreditExposureResponse>> CreditExposure(Guid companyId, Guid partnerId)
    {
        var partner = await _db.Partners.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == partnerId && p.CompanyId == companyId);
        if (partner is null) return NotFound();

        var outstanding = await GetPartnerOutstandingAsync(companyId, partnerId);
        var available = partner.CreditLimit.HasValue
            ? partner.CreditLimit.Value - outstanding
            : (decimal?)null;

        return Ok(new CreditExposureResponse(partner.CreditLimit, outstanding, available));
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
        i.Lines.Select(l => new InvoiceLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.RevenueAccountId, l.DiscountPercent, l.ItemId, l.UnitName, l.UnitFactor, l.LotNumber,
            l.SalesOrderLineId, l.DeliveryLineId)).ToList(),
        i.InternalNotes,
        i.PriceMode,
        i.PaymentTermDays,
        i.GraceDays,
        i.WarehouseId,
        i.ProjectId);
}
