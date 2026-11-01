using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P6 — quotes and sales orders. Sales: Edit keeps drafts, quotes, confirms, closes
// and cancels them; an order never posts. Confirming checks the customer's credit limit and overdue
// block (Sales: Approve overrides, with a reason). Deliveries (Inventory) and invoices made from an
// order carry the line link; delivered and invoiced quantities are always read back from them.
[ApiController]
[Route("api/companies/{companyId:guid}/sales-orders")]
[Authorize]
public class SalesOrdersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numbers;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly Pako.Domain.Tax.ITaxComputationService _tax;
    private readonly SalesCreditService _credit;

    public SalesOrdersController(PakoDbContext db, NumberSeriesService numbers, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access,
        Pako.Domain.Tax.ITaxComputationService tax, SalesCreditService credit)
    {
        _db = db;
        _numbers = numbers;
        _localizer = localizer;
        _access = access;
        _tax = tax;
        _credit = credit;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet(Name = "ListSalesOrders")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<PaginatedResponse<SalesOrderSummaryResponse>>> List(Guid companyId,
        [FromQuery] SalesOrderState? state = null, [FromQuery] Guid? partnerId = null, [FromQuery] string? search = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = Visible(companyId);
        if (state is { } s) query = query.Where(o => o.State == s);
        if (partnerId is { } p) query = query.Where(o => o.PartnerId == p);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(o => (o.Number != null && EF.Functions.ILike(o.Number, pattern))
                || (o.QuoteNumber != null && EF.Functions.ILike(o.QuoteNumber, pattern))
                || (o.CustomerReference != null && EF.Functions.ILike(o.CustomerReference, pattern))
                || _db.Partners.Any(x => x.Id == o.PartnerId && EF.Functions.ILike(x.Name, pattern)));
        }
        var total = await query.CountAsync();
        var orders = await query.OrderByDescending(o => o.Date).ThenByDescending(o => o.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).Include(o => o.Lines).AsNoTracking().ToListAsync();
        var lineIds = orders.SelectMany(o => o.Lines).Select(l => l.Id).ToList();
        var delivered = await SalesOrderQuantities.DeliveredAsync(_db, lineIds);
        var invoiced = await SalesOrderQuantities.InvoicedAsync(_db, lineIds);
        var tracked = await TrackedAsync(companyId, orders.SelectMany(o => o.Lines));
        var partners = await PartnerNamesAsync(orders.Select(o => o.PartnerId));
        return Ok(new PaginatedResponse<SalesOrderSummaryResponse>(orders.Select(o => new SalesOrderSummaryResponse(o.Id, o.QuoteNumber, o.Number,
            o.PartnerId, partners.GetValueOrDefault(o.PartnerId) ?? "?", o.Date, o.DeliveryDate, o.State, o.Lines.Sum(l => l.Gross),
            Progress(o.Lines, l => tracked.Contains(l.ItemId) ? delivered.GetValueOrDefault(l.Id) : invoiced.GetValueOrDefault(l.Id).Posted),
            Progress(o.Lines, l => invoiced.GetValueOrDefault(l.Id).Posted), o.Lines.Count)).ToList(), total, page, pageSize));
    }

    [HttpGet("{id:guid}", Name = "GetSalesOrder")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<SalesOrderResponse>> Get(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: false);
        return order is null ? NotFound() : Ok(await ToResponseAsync(order));
    }

    [HttpPost(Name = "CreateSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(SalesOrderResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<SalesOrderResponse>> Create(Guid companyId, SaveSalesOrderRequest request)
    {
        var items = await ItemsForAsync(companyId, request);
        if (await ValidateAsync(companyId, request, items) is { } error) return BadRequest(error);
        var order = new SalesOrder { Id = Guid.NewGuid(), CompanyId = companyId, CreatedByUserId = CurrentUserId };
        Apply(order, request, items);
        _db.SalesOrders.Add(order);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, await ToResponseAsync(order));
    }

    // Drafts and quotes can be edited; a quote keeps its number.
    [HttpPut("{id:guid}", Name = "UpdateSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<SalesOrderResponse>> Update(Guid companyId, Guid id, SaveSalesOrderRequest request)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State is not (SalesOrderState.Draft or SalesOrderState.Quoted)) return BadRequest(_localizer["SalesOrderNotEditable"].Value);
        var items = await ItemsForAsync(companyId, request);
        if (await ValidateAsync(companyId, request, items) is { } error) return BadRequest(error);
        _db.SalesOrderLines.RemoveRange(order.Lines);
        Apply(order, request, items);
        _db.SalesOrderLines.AddRange(order.Lines);
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync(order));
    }

    [HttpDelete("{id:guid}", Name = "DeleteSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != SalesOrderState.Draft || order.QuoteNumber is not null) return BadRequest(_localizer["SalesOrderNotEditable"].Value);
        _db.SalesOrders.Remove(order);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // Numbers the quote (what the customer receives).
    [HttpPost("{id:guid}/quote", Name = "QuoteSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<SalesOrderResponse>> Quote(Guid companyId, Guid id)
    {
        await using var transaction = await LockCompanyAsync(companyId);
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != SalesOrderState.Draft) return BadRequest(_localizer["SalesOrderNotEditable"].Value);
        order.QuoteNumber ??= await _numbers.ReserveNextAsync(companyId, "SalesQuote", order.Date);
        order.State = SalesOrderState.Quoted;
        order.QuotedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(await ToResponseAsync(order));
    }

    // The customer accepted: numbers the order. Refused over the credit limit or while invoices are
    // overdue past the customer's block, unless Sales: Approve gives a reason.
    [HttpPost("{id:guid}/confirm", Name = "ConfirmSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<SalesOrderResponse>> Confirm(Guid companyId, Guid id, ConfirmSalesOrderRequest request)
    {
        await using var transaction = await LockCompanyAsync(companyId);
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State is not (SalesOrderState.Draft or SalesOrderState.Quoted)) return BadRequest(_localizer["SalesOrderNotEditable"].Value);
        if (order.ValidUntil is { } valid && valid < DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)) && order.State == SalesOrderState.Quoted
            && string.IsNullOrWhiteSpace(request.OverrideReason))
        {
            return BadRequest(_localizer["SalesQuoteExpired"].Value);
        }

        if (await BlockAsync(companyId, order) is { } block)
        {
            if (string.IsNullOrWhiteSpace(request.OverrideReason)) return BadRequest(block);
            if (_access.LevelFor(AccessModule.Sales) < AccessLevel.Approve) return Forbid();
            order.BlockOverriddenByUserId = CurrentUserId;
            order.BlockOverrideReason = request.OverrideReason.Trim()[..Math.Min(500, request.OverrideReason.Trim().Length)];
        }

        order.Number = await _numbers.ReserveNextAsync(companyId, "SalesOrder", order.Date);
        order.State = SalesOrderState.Confirmed;
        order.ConfirmedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(await ToResponseAsync(order));
    }

    // Why the customer can't take this order now, or null.
    private async Task<string?> BlockAsync(Guid companyId, SalesOrder order)
    {
        var status = await _credit.StatusAsync(companyId, order.PartnerId, order.Id);
        if (status is null) return null;
        if (status.OverdueBlocked)
        {
            return string.Format(_localizer["SalesOrderOverdueBlock"].Value, status.Overdue, status.OldestOverdueDays, status.OverdueBlockDays);
        }
        var total = order.Lines.Sum(l => l.Gross);
        if (status.CreditLimit is { } limit && status.Outstanding + status.OpenOrders + total > limit)
        {
            return string.Format(_localizer["SalesOrderCreditBlock"].Value, limit, status.Outstanding, status.OpenOrders, total);
        }
        return null;
    }

    // Back from quote to draft (the customer asked for changes before accepting).
    [HttpPost("{id:guid}/reopen", Name = "ReopenSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<SalesOrderResponse>> Reopen(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != SalesOrderState.Quoted) return BadRequest(_localizer["SalesOrderNotEditable"].Value);
        order.State = SalesOrderState.Draft;
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync(order));
    }

    // Nothing more will be delivered: whatever is still open is dropped.
    [HttpPost("{id:guid}/close", Name = "CloseSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<SalesOrderResponse>> Close(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != SalesOrderState.Confirmed) return BadRequest(_localizer["SalesOrderNotConfirmed"].Value);
        order.State = SalesOrderState.Closed;
        order.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync(order));
    }

    // A quote the customer declined, or an order nothing was delivered or invoiced on.
    [HttpPost("{id:guid}/cancel", Name = "CancelSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<SalesOrderResponse>> Cancel(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State is SalesOrderState.Closed or SalesOrderState.Cancelled) return BadRequest(_localizer["SalesOrderNotEditable"].Value);
        var lineIds = order.Lines.Select(l => l.Id).ToList();
        if (await _db.StockDocumentLines.AnyAsync(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value))
            || await _db.InvoiceLines.AnyAsync(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value)
                && l.Invoice!.State != InvoiceState.Cancelled))
        {
            return BadRequest(_localizer["SalesOrderHasDocuments"].Value);
        }
        order.State = SalesOrderState.Cancelled;
        order.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync(order));
    }

    // A draft delivery note (fletëdërgesë) for the stock-tracked goods still to send. It is checked
    // and posted in Stock documents (Inventory: Approve).
    [HttpPost("{id:guid}/delivery", Name = "CreateDeliveryFromSalesOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    public async Task<ActionResult<Guid>> Deliver(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: false);
        if (order is null) return NotFound();
        if (order.State != SalesOrderState.Confirmed) return BadRequest(_localizer["SalesOrderNotConfirmed"].Value);
        var tracked = await TrackedAsync(companyId, order.Lines);
        var lines = order.Lines.Where(l => tracked.Contains(l.ItemId)).OrderBy(l => l.SortOrder).ToList();
        var open = await OpenToDeliverAsync(lines);
        if (open.Count == 0) return BadRequest(_localizer["SalesOrderNothingToDeliver"].Value);

        var warehouseId = order.WarehouseId ?? (await new StockService(_db, _localizer).DefaultWarehouseAsync(companyId)).Id;
        var document = new StockDocument
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Type = StockDocumentType.Delivery,
            Date = DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)), WarehouseId = warehouseId, PartnerId = order.PartnerId,
            Notes = order.Number,
        };
        foreach (var (line, quantity) in open)
        {
            document.Lines.Add(new StockDocumentLine
            {
                Id = Guid.NewGuid(), StockDocumentId = document.Id, ItemId = line.ItemId!.Value, Quantity = quantity, SalesOrderLineId = line.Id,
            });
        }
        _db.StockDocuments.Add(document);
        await _db.SaveChangesAsync();
        return Ok(document.Id);
    }

    // Base units still to send per tracked line: ordered, less deliveries (drafts too, so pressing
    // "deliver" twice can't make two full drafts) and less invoices that sent goods themselves.
    private async Task<List<(SalesOrderLine Line, decimal Quantity)>> OpenToDeliverAsync(List<SalesOrderLine> lines)
    {
        var ids = lines.Select(l => l.Id).ToList();
        var delivered = await SalesOrderQuantities.DeliveredAsync(_db, ids, includeDrafts: true);
        var directDrafts = await DirectDraftInvoicedAsync(ids);
        return lines.Select(l => (l, l.BaseQuantity - delivered.GetValueOrDefault(l.Id) - directDrafts.GetValueOrDefault(l.Id)))
            .Where(x => x.Item2 > 0).ToList();
    }

    // Draft invoice lines that will take goods out themselves (no delivery named).
    private async Task<Dictionary<Guid, decimal>> DirectDraftInvoicedAsync(List<Guid> lineIds) =>
        await _db.InvoiceLines.AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value) && l.DeliveryLineId == null
                && l.Invoice!.State == InvoiceState.Draft && l.Invoice.DocumentType == DocumentType.Invoice)
            .GroupBy(l => l.SalesOrderLineId!.Value).Select(g => new { g.Key, Quantity = g.Sum(l => l.Quantity * l.UnitFactor) })
            .ToDictionaryAsync(g => g.Key, g => g.Quantity);

    // The lines for an invoice from the order: delivered goods not invoiced yet (one line per
    // delivery line), lines that aren't stock-tracked not invoiced yet and, with undelivered=true,
    // goods not delivered at all (the invoice then sends them itself). Drafts already made count.
    [HttpGet("{id:guid}/invoice-draft", Name = "GetSalesOrderInvoiceDraft")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<SalesInvoiceDraftResponse>> InvoiceDraft(Guid companyId, Guid id, [FromQuery] bool undelivered = false)
    {
        var order = await LoadAsync(companyId, id, tracking: false);
        if (order is null) return NotFound();
        if (order.State != SalesOrderState.Confirmed) return BadRequest(_localizer["SalesOrderNotConfirmed"].Value);
        var tracked = await TrackedAsync(companyId, order.Lines);
        var lineIds = order.Lines.Select(l => l.Id).ToList();
        var invoiced = await SalesOrderQuantities.InvoicedAsync(_db, lineIds);
        var deliveryLines = await _db.StockDocumentLines.AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value)
                && l.StockDocument!.Type == StockDocumentType.Delivery && l.StockDocument.State == StockDocumentState.Posted)
            .Select(l => new { l.Id, OrderLineId = l.SalesOrderLineId!.Value, l.Quantity, l.StockDocument!.Number, l.StockDocument.Date })
            .ToListAsync();
        var deliveryInvoiced = await SalesOrderQuantities.InvoicedDeliveriesAsync(_db, deliveryLines.Select(l => l.Id).ToList(), includeDrafts: true);
        var toDeliver = undelivered
            ? (await OpenToDeliverAsync(order.Lines.Where(l => tracked.Contains(l.ItemId)).ToList())).ToDictionary(x => x.Line.Id, x => x.Quantity)
            : new Dictionary<Guid, decimal>();

        var result = new List<SalesInvoiceDraftLineResponse>();
        foreach (var line in order.Lines.OrderBy(l => l.SortOrder))
        {
            SalesInvoiceDraftLineResponse Draft(decimal baseQuantity, Guid? deliveryLineId, string? deliveryNumber) =>
                new(line.ItemId, line.Description, InLineUnit(line, baseQuantity), line.UnitName, line.UnitPrice, line.DiscountPercent,
                    line.TaxDefinitionId, line.Id, deliveryLineId, deliveryNumber);

            if (tracked.Contains(line.ItemId))
            {
                foreach (var d in deliveryLines.Where(d => d.OrderLineId == line.Id).OrderBy(d => d.Date))
                {
                    var open = d.Quantity - deliveryInvoiced.GetValueOrDefault(d.Id);
                    if (open > 0) result.Add(Draft(open, d.Id, d.Number));
                }
                if (toDeliver.GetValueOrDefault(line.Id) is > 0 and var rest) result.Add(Draft(rest, null, null));
            }
            else
            {
                var (posted, draft) = invoiced.GetValueOrDefault(line.Id);
                var open = line.BaseQuantity - posted - draft;
                if (open > 0) result.Add(Draft(open, null, null));
            }
        }
        if (result.Count == 0) return BadRequest(_localizer["SalesOrderNothingToInvoice"].Value);
        return Ok(new SalesInvoiceDraftResponse(order.PartnerId, order.WarehouseId, order.Number, result));
    }

    // A quantity of base units in the line's unit (4 decimals, as invoice lines hold).
    private static decimal InLineUnit(SalesOrderLine line, decimal baseQuantity) =>
        line.UnitFactor > 0 ? Math.Round(baseQuantity / line.UnitFactor, 4, MidpointRounding.ToZero) : baseQuantity;

    [HttpGet("credit-status", Name = "GetCustomerCreditStatus")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<CreditStatusResponse>> CreditStatus(Guid companyId, [FromQuery] Guid partnerId)
    {
        if (!_access.CanSeePartner(partnerId)) return NotFound();
        var status = await _credit.StatusAsync(companyId, partnerId);
        return status is null ? NotFound() : Ok(status);
    }

    // ---- Helpers ----

    private async Task<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction?> LockCompanyAsync(Guid companyId)
    {
        if (!_db.Database.SupportsRowLocking()) return null;
        var transaction = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        return transaction;
    }

    private IQueryable<SalesOrder> Visible(Guid companyId)
    {
        var query = _db.SalesOrders.AsNoTracking().Where(o => o.CompanyId == companyId);
        if (_access.VisiblePartnerIds is { } partners) query = query.Where(o => partners.Contains(o.PartnerId));
        return query;
    }

    private async Task<SalesOrder?> LoadAsync(Guid companyId, Guid id, bool tracking)
    {
        var query = _db.SalesOrders.Include(o => o.Lines).Where(o => o.Id == id && o.CompanyId == companyId);
        var order = await (tracking ? query : query.AsNoTracking()).FirstOrDefaultAsync();
        return order is null || !_access.CanSeePartner(order.PartnerId) ? null : order;
    }

    private async Task<HashSet<Guid?>> TrackedAsync(Guid companyId, IEnumerable<SalesOrderLine> lines)
    {
        var ids = lines.Where(l => l.ItemId != null).Select(l => l.ItemId).Distinct().ToList();
        var tracked = await new StockService(_db, _localizer).TrackedItemsAsync(companyId, ids);
        return tracked.Keys.Select(k => (Guid?)k).ToHashSet();
    }

    private async Task<Dictionary<Guid, Item>> ItemsForAsync(Guid companyId, SaveSalesOrderRequest request)
    {
        var ids = (request.Lines ?? new()).Where(l => l.ItemId != null).Select(l => l.ItemId!.Value).Distinct().ToList();
        return await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && ids.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
    }

    private async Task<string?> ValidateAsync(Guid companyId, SaveSalesOrderRequest request, Dictionary<Guid, Item> items)
    {
        if (request.Lines is null || request.Lines.Count == 0) return _localizer["PurchaseOrderNoLines"].Value;
        if (request.Lines.Count > 1000) return _localizer["StockDocumentTooManyLines"].Value;
        if (!await _db.Partners.AnyAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId && p.IsCustomer)
            || !_access.CanSeePartner(request.PartnerId))
        {
            return _localizer["InvalidCustomerPartner"].Value;
        }
        if (request.ValidUntil is { } until && until < request.Date) return _localizer["SalesOrderDatesInvalid"].Value;
        if (request.DeliveryDate is { } delivery && delivery < request.Date) return _localizer["SalesOrderDatesInvalid"].Value;
        if (request.WarehouseId is { } w && !await _db.Warehouses.AnyAsync(x => x.Id == w && x.CompanyId == companyId && x.IsActive))
        {
            return _localizer["WarehouseNotFound"].Value;
        }
        if (request.RouteVisitId is { } visit && !await _db.RouteVisits.AnyAsync(v => v.Id == visit && v.CompanyId == companyId && v.PartnerId == request.PartnerId))
        {
            return _localizer["RouteVisitNotFound"].Value;
        }
        if (request.Lines.Any(l => l.Quantity <= 0 || l.Quantity > 1_000_000_000m)) return _localizer["LineQuantityMustBePositive"].Value;
        if (request.Lines.Any(l => l.UnitPrice < 0 || l.UnitPrice > 1_000_000_000m)) return _localizer["LineUnitPriceNonNegative"].Value;
        if (request.Lines.Any(l => l.DiscountPercent is < 0 or > 100)) return _localizer["LineDiscountOutOfRange"].Value;
        if (request.Lines.Any(l => l.ItemId is null && string.IsNullOrWhiteSpace(l.Description))) return _localizer["PurchaseOrderLineDescription"].Value;
        if (request.Lines.Any(l => l.ItemId is { } id && !items.ContainsKey(id))) return _localizer["PriceChangeItemNotFound"].Value;
        foreach (var line in request.Lines)
        {
            var item = line.ItemId is { } id ? items[id] : null;
            if (StockService.ResolveUnit(item, line.UnitName) is null) return string.Format(_localizer["LineUnitUnknown"].Value, line.UnitName);
        }
        var taxIds = request.Lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        if (taxIds.Count > 0 && await _db.TaxDefinitions.CountAsync(t => t.CompanyId == companyId && taxIds.Contains(t.Id)) != taxIds.Count)
        {
            return _localizer["TaxCodeRequired"].Value;
        }
        return null;
    }

    private static void Apply(SalesOrder order, SaveSalesOrderRequest request, Dictionary<Guid, Item> items)
    {
        order.PartnerId = request.PartnerId;
        order.Date = request.Date;
        order.ValidUntil = request.ValidUntil;
        order.DeliveryDate = request.DeliveryDate;
        order.WarehouseId = request.WarehouseId;
        order.RouteVisitId = request.RouteVisitId;
        order.CustomerReference = Clean(request.CustomerReference);
        order.DeliveryAddress = Clean(request.DeliveryAddress);
        order.Notes = Clean(request.Notes);
        order.Lines = request.Lines.Select((l, i) =>
        {
            var item = l.ItemId is { } id ? items[id] : null;
            var unit = StockService.ResolveUnit(item, l.UnitName)!.Value;
            return new SalesOrderLine
            {
                Id = Guid.NewGuid(), SalesOrderId = order.Id, ItemId = l.ItemId,
                Description = string.IsNullOrWhiteSpace(l.Description) ? item?.Name ?? string.Empty : l.Description.Trim(),
                Quantity = l.Quantity, UnitName = unit.Name, UnitFactor = unit.Factor, UnitPrice = l.UnitPrice, DiscountPercent = l.DiscountPercent,
                TaxDefinitionId = l.TaxDefinitionId ?? item?.DefaultTaxDefinitionId, SortOrder = i,
            };
        }).ToList();
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string Progress(IEnumerable<SalesOrderLine> lines, Func<SalesOrderLine, decimal> done)
    {
        var list = lines.ToList();
        var any = list.Any(l => done(l) > 0);
        var full = list.Count > 0 && list.All(l => done(l) >= l.BaseQuantity);
        return full ? "full" : any ? "partly" : "none";
    }

    private async Task<Dictionary<Guid, string>> PartnerNamesAsync(IEnumerable<Guid> ids)
    {
        var list = ids.Distinct().ToList();
        return await _db.Partners.AsNoTracking().Where(p => list.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
    }

    private async Task<SalesOrderResponse> ToResponseAsync(SalesOrder order)
    {
        var lineIds = order.Lines.Select(l => l.Id).ToList();
        var delivered = await SalesOrderQuantities.DeliveredAsync(_db, lineIds);
        var invoiced = await SalesOrderQuantities.InvoicedAsync(_db, lineIds);
        var tracked = await TrackedAsync(order.CompanyId, order.Lines);
        var partner = (await PartnerNamesAsync(new[] { order.PartnerId })).GetValueOrDefault(order.PartnerId) ?? "?";
        var taxIds = order.Lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => taxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);

        var lines = order.Lines.OrderBy(l => l.SortOrder).Select(l =>
        {
            var gross = l.Gross;
            var net = l.TaxDefinitionId is { } t && taxes.TryGetValue(t, out var tax) ? _tax.ComputeFromGross(gross, tax).NetAmount : gross;
            var (posted, draft) = invoiced.GetValueOrDefault(l.Id);
            var isTracked = tracked.Contains(l.ItemId);
            var sent = isTracked ? delivered.GetValueOrDefault(l.Id) : posted;
            return new SalesOrderLineResponse(l.Id, l.ItemId, l.Description, l.Quantity, l.UnitName, l.UnitFactor, l.UnitPrice, l.DiscountPercent,
                l.TaxDefinitionId, net, gross - net, gross, isTracked, InLineUnit(l, sent), InLineUnit(l, posted), InLineUnit(l, draft),
                InLineUnit(l, Math.Max(0m, l.BaseQuantity - sent)), InLineUnit(l, Math.Max(0m, (isTracked ? sent : l.BaseQuantity) - posted)));
        }).ToList();

        var deliveries = await _db.StockDocuments.AsNoTracking()
            .Where(d => d.Type == StockDocumentType.Delivery && d.Lines.Any(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value)))
            .Select(d => new SalesOrderDocumentResponse(d.Id, "delivery", d.Number, d.Date, d.State.ToString()))
            .ToListAsync();
        var invoices = await _db.Invoices.AsNoTracking()
            .Where(i => i.Lines.Any(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId.Value)))
            .Select(i => new SalesOrderDocumentResponse(i.Id, "invoice", i.InvoiceNumber, i.IssueDate, i.State.ToString()))
            .ToListAsync();

        return new SalesOrderResponse(order.Id, order.PartnerId, partner, order.State, order.QuoteNumber, order.Number, order.Date, order.ValidUntil,
            order.DeliveryDate, order.WarehouseId, order.CustomerReference, order.DeliveryAddress, order.Notes, order.RouteVisitId,
            lines.Sum(l => l.Net), lines.Sum(l => l.Vat), lines.Sum(l => l.Gross),
            Progress(order.Lines, l => tracked.Contains(l.ItemId) ? delivered.GetValueOrDefault(l.Id) : invoiced.GetValueOrDefault(l.Id).Posted),
            Progress(order.Lines, l => invoiced.GetValueOrDefault(l.Id).Posted), order.BlockOverrideReason, order.QuotedAt, order.ConfirmedAt, lines,
            deliveries.Concat(invoices).OrderBy(d => d.Date).ToList());
    }
}
