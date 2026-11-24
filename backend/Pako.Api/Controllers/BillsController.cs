using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
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
    private readonly ExportLabels? _labels;

    // HR module: same partner scoping as InvoicesController — hidden bills 404, writes naming an
    // unassigned partner are refused.
    public BillsController(PakoDbContext db, ITaxComputationService taxComputationService, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, ExportLabels? labels = null)
    {
        _labels = labels;
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

        var partnerNames = await PartnerNamesAsync(companyId, bills.Select(b => b.PartnerId));
        var userNames = await UserNamesAsync(bills.Select(b => b.CreatedByUserId));
        return Ok(bills.Select(b => ToResponse(b, partnerNames, userNames)).ToList());
    }

    [HttpGet("paged")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<PaginatedResponse<BillResponse>>> ListPaged(
        Guid companyId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] DocumentType[]? documentType = null,
        [FromQuery] DocumentType[]? excludeDocumentType = null,
        [FromQuery] string? state = null,
        [FromQuery] string? sort = null,
        [FromQuery] Guid? partnerId = null,
        [FromQuery(Name = "from")] DateOnly? issuedFrom = null,
        [FromQuery(Name = "to")] DateOnly? issuedTo = null,
        [FromQuery] string? paymentStatus = null,
        [FromQuery] Guid? warehouseId = null,
        [FromQuery] Guid? createdById = null)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var (query, error) = await FilteredAsync(companyId, search, documentType, excludeDocumentType, state, partnerId, issuedFrom, issuedTo, paymentStatus, warehouseId, createdById);
        if (query is null) return BadRequest(error);
        query = Sorted(query, sort);

        var total = await query.CountAsync();
        var bills = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        var partnerNames = await PartnerNamesAsync(companyId, bills.Select(b => b.PartnerId));
        var userNames = await UserNamesAsync(bills.Select(b => b.CreatedByUserId));
        return Ok(new PaginatedResponse<BillResponse>(bills.Select(b => ToResponse(b, partnerNames, userNames)).ToList(), total, page, pageSize));
    }

    // Client request 2026-11-24: the totals under the list — every document the filters select,
    // across all pages (credit notes and returns negative), plus the posted documents' open balance.
    [HttpGet("paged/totals", Name = "BillListTotals")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<ListTotalsResponse>> ListTotals(
        Guid companyId,
        [FromQuery] string? search = null,
        [FromQuery] DocumentType[]? documentType = null,
        [FromQuery] DocumentType[]? excludeDocumentType = null,
        [FromQuery] string? state = null,
        [FromQuery] Guid? partnerId = null,
        [FromQuery(Name = "from")] DateOnly? issuedFrom = null,
        [FromQuery(Name = "to")] DateOnly? issuedTo = null,
        [FromQuery] string? paymentStatus = null,
        [FromQuery] Guid? warehouseId = null,
        [FromQuery] Guid? createdById = null)
    {
        var (query, error) = await FilteredAsync(companyId, search, documentType, excludeDocumentType, state, partnerId, issuedFrom, issuedTo, paymentStatus, warehouseId, createdById);
        if (query is null) return BadRequest(error);
        var documents = await query.ToListAsync();
        var sum = await new DocumentListTotalsService(_db, _taxComputationService).BillsAsync(companyId, documents);

        decimal? outstanding = null;
        var posted = documents.Where(b => b.State == BillState.Posted).ToList();
        if (posted.Count <= ListTotalsLimits.OutstandingCheckLimit)
        {
            outstanding = 0m;
            foreach (var doc in posted)
            {
                var balance = await ComputeBalanceAsync(companyId, doc.Id, doc.JournalEntryId, doc.DocumentType, doc.PartnerId);
                outstanding += doc.DocumentType is DocumentType.CreditNote or DocumentType.PurchaseReturn ? -balance.Outstanding : balance.Outstanding;
            }
        }

        return Ok(new ListTotalsResponse(documents.Count, sum.AmountBeforeDiscount, sum.DiscountAmount, sum.NetAmount, sum.TaxAmount, sum.GrossAmount, outstanding));
    }

    // The counts next to this list's saved views in the sidebar (all, drafts, posted, overdue).
    [HttpGet("view-counts", Name = "BillViewCounts")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<ViewCountsResponse>> ViewCounts(
        Guid companyId,
        [FromQuery] DocumentType[]? documentType = null,
        [FromQuery] DocumentType[]? excludeDocumentType = null)
    {
        var query = _db.Bills.AsNoTracking().VisibleTo(_access).Where(b => b.CompanyId == companyId);
        if (documentType is { Length: > 0 }) query = query.Where(b => documentType.Contains(b.DocumentType));
        if (excludeDocumentType is { Length: > 0 }) query = query.Where(b => !excludeDocumentType.Contains(b.DocumentType));

        var byState = await query.GroupBy(b => b.State).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var pastDue = await query
            .Where(b => b.State == BillState.Posted && b.DueDate < today && b.DocumentType != DocumentType.CreditNote)
            .Select(b => new { b.Id, b.JournalEntryId, b.DocumentType, b.PartnerId })
            .Take(ListTotalsLimits.OutstandingCheckLimit + 1)
            .ToListAsync();
        int? overdue = null;
        if (pastDue.Count <= ListTotalsLimits.OutstandingCheckLimit)
        {
            overdue = 0;
            foreach (var doc in pastDue)
                if ((await ComputeBalanceAsync(companyId, doc.Id, doc.JournalEntryId, doc.DocumentType, doc.PartnerId)).Outstanding > 0) overdue++;
        }

        return Ok(new ViewCountsResponse(
            byState.Sum(x => x.Count),
            byState.Where(x => x.Key == BillState.Draft).Sum(x => x.Count),
            byState.Where(x => x.Key == BillState.Posted).Sum(x => x.Count),
            overdue));
    }

    [ProducesXlsx]
    [EnableRateLimiting(AuthRateLimit.ExcelExportPolicy)]
    [HttpGet("export", Name = "BillsExport")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<IActionResult> Export(
        Guid companyId,
        [FromQuery] string? search = null,
        [FromQuery] DocumentType[]? documentType = null,
        [FromQuery] DocumentType[]? excludeDocumentType = null,
        [FromQuery] string? state = null,
        [FromQuery] string? sort = null,
        [FromQuery] Guid? partnerId = null,
        [FromQuery(Name = "from")] DateOnly? issuedFrom = null,
        [FromQuery(Name = "to")] DateOnly? issuedTo = null,
        [FromQuery] string? paymentStatus = null,
        [FromQuery] Guid? warehouseId = null,
        [FromQuery] Guid? createdById = null)
    {
        var (query, error) = await FilteredAsync(companyId, search, documentType, excludeDocumentType, state, partnerId, issuedFrom, issuedTo, paymentStatus, warehouseId, createdById);
        if (query is null) return BadRequest(new { error });

        const int maxRows = 10000;
        var rows = await Sorted(query, sort).AsNoTracking().Take(maxRows + 1).ToListAsync();
        if (rows.Count > maxRows) return BadRequest(new { error = _localizer["ExportTooManyRows"].Value });

        var partnerNames = await PartnerNamesAsync(companyId, rows.Select(b => b.PartnerId));
        var userNames = await UserNamesAsync(rows.Select(b => b.CreatedByUserId));
        var labels = _labels ?? new ExportLabels(_localizer);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var headers = new List<string>
        {
            labels["Common_Document"], labels["Common_Type"], labels["Common_Vendor"], labels["Common_IssueDate"], labels["Common_DueDate"],
            labels["Common_State"], labels["Common_CreatedBy"], labels["Common_Total"], labels["Common_Paid"], labels["Common_Outstanding"], labels["Common_PaymentStatus"]
        };

        var cells = new List<IReadOnlyList<object?>>();
        foreach (var b in rows)
        {
            decimal? total = null, paid = null, outstanding = null;
            string? status = null;
            if (b.State == BillState.Posted)
            {
                var balance = await ComputeBalanceAsync(companyId, b.Id, b.JournalEntryId, b.DocumentType, b.PartnerId);
                (total, paid, outstanding) = (balance.Total, balance.Reconciled, balance.Outstanding);
                if (b.DocumentType != DocumentType.CreditNote)
                {
                    var code = balance.Outstanding <= 0 ? "paid" : b.DueDate < today ? "overdue" : balance.Reconciled > 0 ? "partial" : "unpaid";
                    status = labels["Enum_PayStatus_" + code];
                }
            }

            cells.Add(new object?[]
            {
                b.VendorReference, labels.DocType(b.DocumentType == DocumentType.CreditNote ? "SupplierCreditNote" : b.DocumentType.ToString()), partnerNames.GetValueOrDefault(b.PartnerId), b.IssueDate, b.DueDate,
                b.State.ToString(), b.CreatedByUserId is { } creator ? userNames.GetValueOrDefault(creator) : null, total, paid, outstanding, status
            });
        }

        var bytes = ExcelExportService.BuildWorkbook(labels["Sheet_PurchaseInvoices"], headers, cells);
        return File(bytes, ExcelExportService.XlsxContentType, $"bills-{today:yyyyMMdd}.xlsx");
    }

    private async Task<(IQueryable<Bill>? Query, string? Error)> FilteredAsync(
        Guid companyId, string? search, DocumentType[]? documentType, DocumentType[]? excludeDocumentType, string? state,
        Guid? partnerId, DateOnly? issuedFrom, DateOnly? issuedTo, string? paymentStatus, Guid? warehouseId = null, Guid? createdById = null)
    {
        var query = _db.Bills.AsNoTracking().VisibleTo(_access)
            .Include(b => b.Lines)
            .Where(b => b.CompanyId == companyId);

        if (!string.IsNullOrWhiteSpace(state))
        {
            var states = Enum.GetValues<BillState>().Where(s => s.ToString().StartsWith(state.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
            query = query.Where(b => states.Contains(b.State));
        }

        if (partnerId is { } pid) query = query.Where(b => b.PartnerId == pid);
        // Client request 2026-11-24: the list ribbon's warehouse and "created by" filters.
        if (warehouseId is { } wid) query = query.Where(b => b.WarehouseId == wid);
        if (createdById is { } uid) query = query.Where(b => b.CreatedByUserId == uid);

        if (issuedFrom is { } fromDate) query = query.Where(b => b.IssueDate >= fromDate);
        if (issuedTo is { } toDate) query = query.Where(b => b.IssueDate <= toDate);

        if (documentType is { Length: > 0 }) query = query.Where(b => documentType.Contains(b.DocumentType));
        if (excludeDocumentType is { Length: > 0 }) query = query.Where(b => !excludeDocumentType.Contains(b.DocumentType));

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = LikePattern.Contains(search);
            var partnerIds = _db.Partners.Where(p => p.CompanyId == companyId && EF.Functions.ILike(p.Name, pattern, LikePattern.EscapeChar)).Select(p => p.Id);
            query = query.Where(b =>
                (b.VendorReference != null && EF.Functions.ILike(b.VendorReference, pattern, LikePattern.EscapeChar)) ||
                partnerIds.Contains(b.PartnerId));
        }

        if (!string.IsNullOrWhiteSpace(paymentStatus))
        {
            var wanted = paymentStatus.Trim().ToLowerInvariant();
            if (wanted is not ("unpaid" or "partial" or "paid" or "overdue")) return (null, _localizer["PaymentStatusInvalid"].Value);
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var candidates = await query
                .Where(b => b.State == BillState.Posted && b.DocumentType != DocumentType.CreditNote)
                .Select(b => new { b.Id, b.JournalEntryId, b.DocumentType, b.PartnerId, b.DueDate })
                .ToListAsync();
            var matching = new List<Guid>();
            foreach (var c in candidates)
            {
                var balance = await ComputeBalanceAsync(companyId, c.Id, c.JournalEntryId, c.DocumentType, c.PartnerId);
                var status = balance.Outstanding <= 0 ? "paid" : c.DueDate < today ? "overdue" : balance.Reconciled > 0 ? "partial" : "unpaid";
                if (status == wanted) matching.Add(c.Id);
            }

            query = query.Where(b => matching.Contains(b.Id));
        }

        return (query, null);
    }

    private IQueryable<Bill> Sorted(IQueryable<Bill> query, string? sort)
    {
        var descending = sort is not null && sort.StartsWith('-');
        var sortField = descending ? sort![1..] : sort;
        query = (sortField?.ToLowerInvariant() switch
        {
            "vendorreference" => descending ? query.OrderByDescending(b => b.VendorReference) : query.OrderBy(b => b.VendorReference),
            "duedate" => descending ? query.OrderByDescending(b => b.DueDate) : query.OrderBy(b => b.DueDate),
            "state" => descending ? query.OrderByDescending(b => b.State) : query.OrderBy(b => b.State),
            "vendor" => descending
                ? query.OrderByDescending(b => _db.Partners.Where(p => p.Id == b.PartnerId).Select(p => p.Name).FirstOrDefault())
                : query.OrderBy(b => _db.Partners.Where(p => p.Id == b.PartnerId).Select(p => p.Name).FirstOrDefault()),
            "issuedate" => descending ? query.OrderByDescending(b => b.IssueDate) : query.OrderBy(b => b.IssueDate),
            _ => query.OrderByDescending(b => b.IssueDate).ThenByDescending(b => b.CreatedAt)
        }).ThenBy(b => b.Id);
        return query;
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

        // Line and document amounts from the posting calculator, so the bill page shows the same
        // net / VAT / total the ledger gets and never computes money itself.
        var taxIds = bill.Lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines)
            .Where(t => t.CompanyId == companyId && taxIds.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);
        DocumentLineAmounts LineAmounts(BillLine line) => DocumentLineCalculator.Amounts(
            line.Quantity, line.UnitPrice, line.DiscountPercent,
            line.TaxDefinitionId is { } taxId ? taxes.GetValueOrDefault(taxId) : null,
            _taxComputationService, bill.PriceMode);

        return Ok(ToResponse(bill, lineAmounts: LineAmounts));
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
        // Client request 2026-11-23: the vendor's own line defaults, used after the line's and the
        // item's (and the item category's) and before the company's.
        var partnerDefaults = await _db.Partners.AsNoTracking()
            .Where(p => p.Id == partnerId && p.CompanyId == companyId)
            .Select(p => new { p.DefaultPurchaseTaxDefinitionId, p.DefaultExpenseAccountId })
            .FirstOrDefaultAsync();

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

            var taxDefinitionId = line.TaxDefinitionId ?? item?.DefaultTaxDefinitionId ?? partnerDefaults?.DefaultPurchaseTaxDefinitionId;

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
                : line.ExpenseAccountId ?? item?.DefaultExpenseAccountId ?? category?.ExpenseAccountId
                    ?? partnerDefaults?.DefaultExpenseAccountId ?? defaultExpenseAccountId;
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
            // A line with no item keeps whatever unit the user typed (kg, orë, …) at factor 1: it
            // moves no stock, the unit is only printed.
            if (item is null && !string.IsNullOrWhiteSpace(line.UnitName))
            {
                var freeUnit = line.UnitName.Trim();
                if (freeUnit.Length > 32)
                {
                    return (null, 0m, BadRequest(_localizer["LineUnitTooLong"].Value));
                }
                unit = (freeUnit, 1m);
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

    // Mirror of InvoicesController.ValidateOriginalInvoiceAsync: the original is optional, a
    // PurchaseReturn included. When one is given it must belong to the company and be a Bill from
    // the same vendor (a return against a credit note or another vendor's bill cannot post).
    private async Task<ActionResult?> ValidateOriginalBillAsync(Guid companyId, DocumentType documentType, Guid? originalBillId, Guid partnerId)
    {
        if (originalBillId is { } id)
        {
            var original = await _db.Bills.AsNoTracking().VisibleTo(_access)
                .Where(b => b.Id == id && b.CompanyId == companyId)
                .Select(b => new { b.PartnerId, b.DocumentType })
                .FirstOrDefaultAsync();
            if (original is null)
            {
                return BadRequest(_localizer["OriginalBillNotBelongToCompany"].Value);
            }
            if (original.PartnerId != partnerId || original.DocumentType != DocumentType.Bill)
            {
                return BadRequest(_localizer["OriginalBillMustMatchVendorAndType"].Value);
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

        var originalBillError = await ValidateOriginalBillAsync(companyId, request.DocumentType, request.OriginalBillId, request.PartnerId);
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
            DueDate = request.DueDate ?? request.IssueDate,
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

        var wasPosted = bill.State == BillState.Posted;

        if (wasPosted)
        {
            try
            {
                await MonthLockService.EnsureMonthOpenAsync(_db, companyId, bill.IssueDate);
            }
            catch (MonthLockViolationException ex)
            {
                return BadRequest(ex.Message);
            }
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

        var originalBillError = await ValidateOriginalBillAsync(companyId, request.DocumentType, request.OriginalBillId, request.PartnerId);
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
        bill.DueDate = request.DueDate ?? request.IssueDate;
        bill.DocumentType = request.DocumentType;
        bill.OriginalBillId = request.OriginalBillId;
        bill.InternalNotes = request.InternalNotes;
        bill.WarehouseId = request.WarehouseId;
        bill.ProjectId = request.ProjectId;

        if (wasPosted)
        {
            var oldJournalEntry = await _db.JournalEntries.Include(e => e.Lines)
                .FirstOrDefaultAsync(e => e.Id == bill.JournalEntryId);
            if (oldJournalEntry is not null)
            {
                var effectiveCompany = await AccountLockService.GetEffectiveCompanyAsync(_db, company, CurrentUserId);
                try
                {
                    var reversal = oldJournalEntry.Reverse(effectiveCompany, bill.IssueDate, $"Re-edit reversal of {bill.VendorReference}");
                    reversal.PostedByUserId = CurrentUserId;
                    reversal.SourceDocumentId = oldJournalEntry.Id;
                    _db.JournalEntries.Add(reversal);
                }
                catch (Exception ex) when (
                    ex is AccountingLockDateViolationException or
                    TaxLockDateViolationException or
                    HardLockDateViolationException)
                {
                    return BadRequest(ex.Message);
                }
            }

            bill.State = BillState.Draft;
            bill.JournalEntryId = null;

            await _db.SaveChangesAsync();

            var trackedCompany = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (trackedCompany is null) return NotFound();

            var postError = await PostDraftBillAsync(trackedCompany, bill);
            if (postError is not null) return postError;

            AuditController.Stage(_db, companyId, "Bill", bill.Id.ToString(),
                "ReEdit", CurrentUserId.ToString(), $"VendorRef: {bill.VendorReference}");

            await _db.SaveChangesAsync();
        }
        else
        {
            await _db.SaveChangesAsync();
        }

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

        try { await MonthLockService.EnsureMonthOpenAsync(_db, companyId, bill.IssueDate); }
        catch (MonthLockViolationException ex) { return BadRequest(ex.Message); }

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

    [HttpPost("balances")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<Dictionary<Guid, DocumentBalanceResponse>>> Balances(Guid companyId, [FromBody] List<Guid> billIds)
    {
        if (billIds is not { Count: > 0 }) return Ok(new Dictionary<Guid, DocumentBalanceResponse>());
        var ids = billIds.Distinct().Take(200).ToList();

        var bills = await _db.Bills.AsNoTracking().VisibleTo(_access)
            .Where(b => b.CompanyId == companyId && ids.Contains(b.Id))
            .Select(b => new { b.Id, b.JournalEntryId, b.DocumentType, b.PartnerId })
            .ToListAsync();

        var result = new Dictionary<Guid, DocumentBalanceResponse>();
        foreach (var bill in bills)
            result[bill.Id] = await ComputeBalanceAsync(companyId, bill.Id, bill.JournalEntryId, bill.DocumentType, bill.PartnerId);

        return Ok(result);
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

        try { await MonthLockService.EnsureMonthOpenAsync(_db, companyId, bill.IssueDate); }
        catch (MonthLockViolationException ex) { return BadRequest(ex.Message); }

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
        var outcome = await new PaymentRecorder(_db, _localizer).ForBillAsync(company, bill, amount, cashOrBankAccountId, date);
        if (outcome.NotFound) return new RecordPaymentOutcome(NotFound(), null);
        if (outcome.Error is not null) return new RecordPaymentOutcome(BadRequest(outcome.Error), null);
        return new RecordPaymentOutcome(null, outcome.Reconciliation);
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

        try { await MonthLockService.EnsureMonthOpenAsync(_db, companyId, bill.IssueDate); }
        catch (MonthLockViolationException ex) { return BadRequest(ex.Message); }

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

        // InPayment: sum of outstanding Payment records (2-step, awaiting bank rec) for this bill
        var inPayment = await _db.Payments.AsNoTracking()
            .Where(p => p.BillId == billId && p.State == Domain.Payments.PaymentState.Posted)
            .SumAsync(p => p.Amount);

        return new DocumentBalanceResponse(total, reconciled, total - reconciled, inPayment);
    }

    private static ReconciliationResponse ToReconciliationResponse(Reconciliation r) =>
        new(r.Id, r.InvoiceId, r.BillId, r.JournalEntryLineId, r.Amount, r.ReconciledAt);

    private Task<CompanyAccountDefaults?> GetAccountDefaultsAsync(Guid companyId) =>
        _db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);

    // B8: partner's own PayableAccountId wins when set and the caller has a partner to ask about
    // (every call site that posts, pays, or reads a specific document does); the company's
    // default otherwise — mirrors InvoicesController.GetReceivableAccountIdAsync exactly.
    private Task<Guid> GetPayableAccountIdAsync(Guid companyId, Guid? partnerId = null) =>
        new PaymentRecorder(_db, _localizer).PayableAccountIdAsync(companyId, partnerId);

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
    [EnableRateLimiting(AuthRateLimit.DocumentPostingPolicy)]
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
            await MonthLockService.EnsureMonthOpenAsync(_db, company.Id, bill.IssueDate);
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
            MonthLockViolationException or
            InconsistentForeignCurrencyDataException)
        {
            return BadRequest(ex.Message);
        }

        // A2 (v2 release): mirror of InvoicesController.PostDraftInvoiceAsync's SalesReturn check —
        // goods returned to a supplier must not exceed what the original bill still has
        // un-returned. Checked after bill.Post() succeeded, before numbering/SaveChangesAsync.
        // A return with no original bill has no cap: there is nothing to measure it against.
        if (bill.DocumentType == DocumentType.PurchaseReturn && bill.OriginalBillId is { } originalBillId)
        {
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

    private async Task<Dictionary<Guid, string>> PartnerNamesAsync(Guid companyId, IEnumerable<Guid> partnerIds)
    {
        var ids = partnerIds.Distinct().ToList();
        if (ids.Count == 0) return new();
        return await _db.Partners.AsNoTracking()
            .Where(p => p.CompanyId == companyId && ids.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name);
    }

    private async Task<Dictionary<Guid, string>> UserNamesAsync(IEnumerable<Guid?> userIds)
    {
        var ids = userIds.Where(u => u.HasValue).Select(u => u!.Value).Distinct().ToList();
        if (ids.Count == 0) return new();
        return await _db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.FullName ?? u.Email ?? string.Empty);
    }

    private static BillResponse ToResponse(Bill b, Dictionary<Guid, string>? partnerNames = null, Dictionary<Guid, string>? userNames = null,
        Func<BillLine, DocumentLineAmounts>? lineAmounts = null)
    {
        var amounts = lineAmounts is null ? null : b.Lines.ToDictionary(l => l.Id, lineAmounts);
        InvoiceAmountTotals? totals = null;
        List<InvoiceTaxBreakdownLine>? breakdown = null;
        if (amounts is not null)
        {
            var sum = DocumentLineAmounts.Sum(amounts.Values);
            totals = new InvoiceAmountTotals(sum.AmountBeforeDiscount, sum.DiscountAmount, sum.NetAmount, sum.TaxAmount, sum.GrossAmount);
            breakdown = b.Lines
                .Where(l => l.TaxDefinitionId != null)
                .GroupBy(l => l.TaxDefinitionId!.Value)
                .Select(g => new InvoiceTaxBreakdownLine(g.Key, g.Sum(l => amounts[l.Id].NetAmount), g.Sum(l => amounts[l.Id].TaxAmount)))
                .ToList();
        }

        return ToResponseCore(b, partnerNames, userNames, amounts, totals, breakdown);
    }

    private static BillResponse ToResponseCore(Bill b, Dictionary<Guid, string>? partnerNames, Dictionary<Guid, string>? userNames,
        Dictionary<Guid, DocumentLineAmounts>? amounts, InvoiceAmountTotals? totals, List<InvoiceTaxBreakdownLine>? breakdown) => new(
        b.Id,
        b.PartnerId,
        partnerNames?.GetValueOrDefault(b.PartnerId),
        b.VendorReference,
        b.IssueDate,
        b.DueDate,
        b.State.ToString(),
        b.DocumentType,
        b.OriginalBillId,
        b.JournalEntryId,
        b.Lines.Select(l =>
        {
            var a = amounts?.GetValueOrDefault(l.Id);
            return new BillLineResponse(l.Id, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId, l.ExpenseAccountId, l.DiscountPercent, l.ItemId, l.PurchaseOrderLineId, l.UnitName, l.UnitFactor, l.LotNumber, l.ExpiryDate, l.CostCodeId,
                a?.AmountBeforeDiscount, a?.DiscountAmount, a?.NetAmount, a?.TaxAmount, a?.GrossAmount);
        }).ToList(),
        b.InternalNotes,
        b.PriceMode,
        b.WarehouseId,
        b.ProjectId,
        b.CreatedByUserId,
        b.CreatedByUserId is { } creator ? userNames?.GetValueOrDefault(creator) : null,
        totals,
        breakdown);
}
