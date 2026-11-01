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
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using PriceMode = Pako.Domain.Invoicing.PriceMode;
using Pako.Domain.Tax;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/INVENTORY_PLAN.md §12 P5 — purchase orders. Purchases: Edit keeps drafts, confirms, closes
// and cancels them; an order never posts. Bills made from an order carry the line link, and the
// billed quantities are always read back from the bills.
[ApiController]
[Route("api/companies/{companyId:guid}/purchase-orders")]
[Authorize]
public class PurchaseOrdersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly NumberSeriesService _numbers;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly Pako.Domain.Tax.ITaxComputationService _tax;

    public PurchaseOrdersController(PakoDbContext db, NumberSeriesService numbers, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access,
        Pako.Domain.Tax.ITaxComputationService tax)
    {
        _db = db;
        _numbers = numbers;
        _localizer = localizer;
        _access = access;
        _tax = tax;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet(Name = "ListPurchaseOrders")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<PaginatedResponse<PurchaseOrderSummaryResponse>>> List(Guid companyId,
        [FromQuery] PurchaseOrderState? state = null, [FromQuery] Guid? partnerId = null, [FromQuery] string? search = null,
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
                || _db.Partners.Any(x => x.Id == o.PartnerId && EF.Functions.ILike(x.Name, pattern)));
        }
        var total = await query.CountAsync();
        var orders = await query.OrderByDescending(o => o.Date).ThenByDescending(o => o.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).Include(o => o.Lines).AsNoTracking().ToListAsync();
        var billed = await BilledAsync(orders.SelectMany(o => o.Lines).Select(l => l.Id).ToList());
        var partners = await PartnerNamesAsync(orders.Select(o => o.PartnerId));
        return Ok(new PaginatedResponse<PurchaseOrderSummaryResponse>(orders.Select(o => new PurchaseOrderSummaryResponse(o.Id, o.Number,
            o.PartnerId, partners.GetValueOrDefault(o.PartnerId) ?? "?", o.Date, o.ExpectedDate, o.State, Progress(o, billed), o.Lines.Count)).ToList(),
            total, page, pageSize));
    }

    [HttpGet("{id:guid}", Name = "GetPurchaseOrder")]
    [RequireCompanyAccess(module: AccessModule.Purchases)]
    public async Task<ActionResult<PurchaseOrderResponse>> Get(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: false);
        return order is null ? NotFound() : Ok(await ToResponseAsync(order));
    }

    [HttpPost(Name = "CreatePurchaseOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    [ProducesResponseType(typeof(PurchaseOrderResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PurchaseOrderResponse>> Create(Guid companyId, SavePurchaseOrderRequest request)
    {
        if (await ValidateAsync(companyId, request) is { } error) return BadRequest(error);
        var order = new PurchaseOrder { Id = Guid.NewGuid(), CompanyId = companyId, CreatedByUserId = CurrentUserId };
        Apply(order, request);
        _db.PurchaseOrders.Add(order);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, await ToResponseAsync(order));
    }

    [HttpPut("{id:guid}", Name = "UpdatePurchaseOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    public async Task<ActionResult<PurchaseOrderResponse>> Update(Guid companyId, Guid id, SavePurchaseOrderRequest request)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != PurchaseOrderState.Draft) return BadRequest(_localizer["PurchaseOrderNotDraft"].Value);
        if (await ValidateAsync(companyId, request) is { } error) return BadRequest(error);
        _db.PurchaseOrderLines.RemoveRange(order.Lines);
        Apply(order, request);
        _db.PurchaseOrderLines.AddRange(order.Lines);
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync(order));
    }

    [HttpDelete("{id:guid}", Name = "DeletePurchaseOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != PurchaseOrderState.Draft) return BadRequest(_localizer["PurchaseOrderNotDraft"].Value);
        _db.PurchaseOrders.Remove(order);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // Confirming numbers the order (it is what the vendor receives).
    [HttpPost("{id:guid}/confirm", Name = "ConfirmPurchaseOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    public async Task<ActionResult<PurchaseOrderResponse>> Confirm(Guid companyId, Guid id)
    {
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != PurchaseOrderState.Draft) return BadRequest(_localizer["PurchaseOrderNotDraft"].Value);
        order.Number = await _numbers.ReserveNextAsync(companyId, "PurchaseOrder", order.Date);
        order.State = PurchaseOrderState.Confirmed;
        order.ConfirmedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok(await ToResponseAsync(order));
    }

    // Nothing more is expected: whatever wasn't billed is dropped.
    [HttpPost("{id:guid}/close", Name = "ClosePurchaseOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    public async Task<ActionResult<PurchaseOrderResponse>> Close(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != PurchaseOrderState.Confirmed) return BadRequest(_localizer["PurchaseOrderNotConfirmed"].Value);
        order.State = PurchaseOrderState.Closed;
        order.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync(order));
    }

    // Only an order nothing has been billed against can be cancelled; otherwise close it.
    [HttpPost("{id:guid}/cancel", Name = "CancelPurchaseOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    public async Task<ActionResult<PurchaseOrderResponse>> Cancel(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: true);
        if (order is null) return NotFound();
        if (order.State != PurchaseOrderState.Confirmed) return BadRequest(_localizer["PurchaseOrderNotConfirmed"].Value);
        var lineIds = order.Lines.Select(l => l.Id).ToList();
        if (await _db.BillLines.AnyAsync(l => l.PurchaseOrderLineId != null && lineIds.Contains(l.PurchaseOrderLineId.Value)))
        {
            return BadRequest(_localizer["PurchaseOrderHasBills"].Value);
        }
        order.State = PurchaseOrderState.Cancelled;
        order.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(await ToResponseAsync(order));
    }

    // §12 P6: a draft receipt (fletëpranim) for what is still to arrive, at the order's net price per
    // unit. It is checked and posted in Stock documents (Inventory: Approve).
    [HttpPost("{id:guid}/receipt", Name = "CreateReceiptFromPurchaseOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Inventory)]
    public async Task<ActionResult<Guid>> Receive(Guid companyId, Guid id)
    {
        var order = await LoadAsync(companyId, id, tracking: false);
        if (order is null) return NotFound();
        if (order.State != PurchaseOrderState.Confirmed) return BadRequest(_localizer["PurchaseOrderNotConfirmed"].Value);
        // Receipts still in draft count too: pressing "receive" twice must not make two full drafts.
        var received = await ReceivedAsync(order.Lines.Select(l => l.Id).ToList(), includeDraftReceipts: true);
        var tracked = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && i.TrackInventory && i.Type == ItemType.Goods)
            .Select(i => i.Id).ToListAsync();
        var taxIds = order.Lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).ToList();
        var taxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => taxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        var open = order.Lines.Where(l => l.ItemId is { } item && tracked.Contains(item) && l.Quantity > received.GetValueOrDefault(l.Id)).ToList();
        if (open.Count == 0) return BadRequest(_localizer["PurchaseOrderNothingToReceive"].Value);

        var warehouseId = order.WarehouseId ?? (await new StockService(_db, _localizer).DefaultWarehouseAsync(companyId)).Id;
        var document = new StockDocument
        {
            Id = Guid.NewGuid(), CompanyId = companyId, Type = StockDocumentType.Receipt, Date = DateOnly.FromDateTime(DateTime.UtcNow),
            WarehouseId = warehouseId, PartnerId = order.PartnerId, Notes = order.Number,
        };
        foreach (var line in open)
        {
            var quantity = line.Quantity - received.GetValueOrDefault(line.Id);
            // The order price is VAT-inclusive; the stock cost is net of deductible VAT.
            var gross = AverageCost.Money(quantity * line.UnitPrice);
            var net = line.TaxDefinitionId is { } t && taxes.TryGetValue(t, out var tax) ? _tax.ComputeFromGross(gross, tax).NetAmount : gross;
            document.Lines.Add(new StockDocumentLine
            {
                Id = Guid.NewGuid(), StockDocumentId = document.Id, ItemId = line.ItemId!.Value, Quantity = quantity,
                UnitCost = AverageCost.UnitCost(net / quantity), PurchaseOrderLineId = line.Id,
            });
        }
        _db.StockDocuments.Add(document);
        await _db.SaveChangesAsync();
        return Ok(document.Id);
    }

    private Task<Dictionary<Guid, decimal>> ReceivedAsync(List<Guid> lineIds, bool includeDraftReceipts = false) =>
        PurchaseOrderQuantities.ReceivedAsync(_db, lineIds, includeDraftReceipts);

    // The low-stock list as orders: every stock-tracked item below its minimum, grouped by the
    // vendor it was last bought from, ordered up to the minimum at the last purchase price. Items
    // never bought from anyone are counted, not ordered.
    [HttpPost("from-low-stock", Name = "CreatePurchaseOrdersFromLowStock")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Purchases)]
    public async Task<ActionResult<LowStockOrdersResponse>> FromLowStock(Guid companyId)
    {
        if (_access.LevelFor(AccessModule.Inventory) < AccessLevel.Read) return Forbid();
        var low = await _db.Items.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.TrackInventory && i.Type == ItemType.Goods && i.MinimumStock != null)
            .Select(i => new
            {
                i.Id, i.Name, i.MinimumStock, i.DefaultTaxDefinitionId,
                Quantity = _db.ItemCosts.Where(k => k.ItemId == i.Id).Select(k => (decimal?)k.Quantity).FirstOrDefault() ?? 0m,
            })
            .ToListAsync();
        low = low.Where(i => i.Quantity < i.MinimumStock!.Value).ToList();
        var ids = low.Select(i => i.Id).ToList();
        var lastBought = (await _db.BillLines.AsNoTracking()
                .Where(l => l.ItemId != null && ids.Contains(l.ItemId.Value) && l.Bill!.CompanyId == companyId
                    && l.Bill.State == BillState.Posted && l.Bill.DocumentType == DocumentType.Bill)
                .Select(l => new { ItemId = l.ItemId!.Value, l.Bill!.PartnerId, l.UnitPrice, l.UnitFactor, l.Bill.PriceMode, l.TaxDefinitionId, l.Bill.IssueDate, l.Bill.CreatedAt })
                .ToListAsync())
            .Where(l => _access.CanSeePartner(l.PartnerId))
            .GroupBy(l => l.ItemId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(l => l.IssueDate).ThenByDescending(l => l.CreatedAt).First());

        var lastTaxIds = lastBought.Values.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        var lastTaxes = await _db.TaxDefinitions.AsNoTracking().Include(t => t.RepartitionLines).Where(t => lastTaxIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var created = new List<Guid>();
        foreach (var group in low.Where(i => lastBought.ContainsKey(i.Id)).GroupBy(i => lastBought[i.Id].PartnerId))
        {
            var order = new PurchaseOrder
            {
                Id = Guid.NewGuid(), CompanyId = companyId, PartnerId = group.Key, Date = today, CreatedByUserId = CurrentUserId,
                Notes = _localizer["PurchaseOrderFromLowStock"].Value,
            };
            var sort = 0;
            foreach (var item in group)
            {
                var last = lastBought[item.Id];
                order.Lines.Add(new PurchaseOrderLine
                {
                    Id = Guid.NewGuid(), PurchaseOrderId = order.Id, ItemId = item.Id, Description = item.Name,
                    Quantity = item.MinimumStock!.Value - item.Quantity, UnitPrice = OrderPrice(last.UnitPrice, last.UnitFactor, last.PriceMode, last.TaxDefinitionId, lastTaxes),
                    TaxDefinitionId = last.TaxDefinitionId, SortOrder = sort++,
                });
            }
            _db.PurchaseOrders.Add(order);
            created.Add(order.Id);
        }
        await _db.SaveChangesAsync();
        return Ok(new LowStockOrdersResponse(created, low.Count, low.Count(i => !lastBought.ContainsKey(i.Id))));
    }

    // ---- Helpers ----

    // An order line is priced per base unit, VAT-inclusive; the last bill may have been per box and
    // net of VAT.
    private decimal OrderPrice(decimal billPrice, decimal unitFactor, PriceMode mode, Guid? taxId, Dictionary<Guid, TaxDefinition> taxes)
    {
        var perUnit = unitFactor > 0 ? billPrice / unitFactor : billPrice;
        if (mode == PriceMode.NetExclusive && taxId is { } t && taxes.TryGetValue(t, out var tax)) perUnit = _tax.Compute(perUnit, tax).TotalAmount;
        return AverageCost.UnitCost(perUnit);
    }

    // Partner-scoped members only see orders for their partners.
    private IQueryable<PurchaseOrder> Visible(Guid companyId)
    {
        var query = _db.PurchaseOrders.AsNoTracking().Where(o => o.CompanyId == companyId);
        if (_access.VisiblePartnerIds is { } partners) query = query.Where(o => partners.Contains(o.PartnerId));
        return query;
    }

    private async Task<PurchaseOrder?> LoadAsync(Guid companyId, Guid id, bool tracking)
    {
        var query = _db.PurchaseOrders.Include(o => o.Lines).Where(o => o.Id == id && o.CompanyId == companyId);
        var order = await (tracking ? query : query.AsNoTracking()).FirstOrDefaultAsync();
        return order is null || !_access.CanSeePartner(order.PartnerId) ? null : order;
    }

    private async Task<string?> ValidateAsync(Guid companyId, SavePurchaseOrderRequest request)
    {
        if (request.Lines is null || request.Lines.Count == 0) return _localizer["PurchaseOrderNoLines"].Value;
        if (request.Lines.Count > 1000) return _localizer["StockDocumentTooManyLines"].Value;
        if (!await _db.Partners.AnyAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId && p.IsVendor)
            || !_access.CanSeePartner(request.PartnerId))
        {
            return _localizer["PurchaseOrderVendorRequired"].Value;
        }
        if (request.ExpectedDate is { } expected && expected < request.Date) return _localizer["PurchaseOrderExpectedBeforeDate"].Value;
        if (request.WarehouseId is { } w && !await _db.Warehouses.AnyAsync(x => x.Id == w && x.CompanyId == companyId && x.IsActive))
        {
            return _localizer["WarehouseNotFound"].Value;
        }
        if (request.Lines.Any(l => l.Quantity <= 0 || l.Quantity > 1_000_000_000m)) return _localizer["LineQuantityMustBePositive"].Value;
        if (request.Lines.Any(l => l.UnitPrice < 0)) return _localizer["LineUnitPriceNonNegative"].Value;
        if (request.Lines.Any(l => l.ItemId is null && string.IsNullOrWhiteSpace(l.Description))) return _localizer["PurchaseOrderLineDescription"].Value;
        var itemIds = request.Lines.Where(l => l.ItemId != null).Select(l => l.ItemId!.Value).Distinct().ToList();
        if (itemIds.Count > 0 && await _db.Items.CountAsync(i => i.CompanyId == companyId && itemIds.Contains(i.Id)) != itemIds.Count)
        {
            return _localizer["PriceChangeItemNotFound"].Value;
        }
        var taxIds = request.Lines.Where(l => l.TaxDefinitionId != null).Select(l => l.TaxDefinitionId!.Value).Distinct().ToList();
        if (taxIds.Count > 0 && await _db.TaxDefinitions.CountAsync(t => t.CompanyId == companyId && taxIds.Contains(t.Id)) != taxIds.Count)
        {
            return _localizer["TaxCodeRequired"].Value;
        }
        return null;
    }

    private static void Apply(PurchaseOrder order, SavePurchaseOrderRequest request)
    {
        order.PartnerId = request.PartnerId;
        order.Date = request.Date;
        order.ExpectedDate = request.ExpectedDate;
        order.WarehouseId = request.WarehouseId;
        order.VendorReference = string.IsNullOrWhiteSpace(request.VendorReference) ? null : request.VendorReference.Trim();
        order.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        order.Lines = request.Lines.Select((l, i) => new PurchaseOrderLine
        {
            Id = Guid.NewGuid(), PurchaseOrderId = order.Id, ItemId = l.ItemId, Description = l.Description?.Trim() ?? string.Empty,
            Quantity = l.Quantity, UnitPrice = l.UnitPrice, TaxDefinitionId = l.TaxDefinitionId, SortOrder = i,
        }).ToList();
    }

    private Task<Dictionary<Guid, (decimal Posted, decimal Draft)>> BilledAsync(List<Guid> lineIds) =>
        PurchaseOrderQuantities.BilledAsync(_db, lineIds);

    private static string Progress(PurchaseOrder order, Dictionary<Guid, (decimal Posted, decimal Draft)> billed)
    {
        var any = order.Lines.Any(l => billed.GetValueOrDefault(l.Id).Posted > 0);
        var full = order.Lines.Count > 0 && order.Lines.All(l => billed.GetValueOrDefault(l.Id).Posted >= l.Quantity);
        return full ? "full" : any ? "partly" : "none";
    }

    private async Task<Dictionary<Guid, string>> PartnerNamesAsync(IEnumerable<Guid> ids)
    {
        var list = ids.Distinct().ToList();
        return await _db.Partners.AsNoTracking().Where(p => list.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
    }

    private async Task<PurchaseOrderResponse> ToResponseAsync(PurchaseOrder order)
    {
        var lineIds = order.Lines.Select(l => l.Id).ToList();
        var billed = await BilledAsync(lineIds);
        var received = await ReceivedAsync(lineIds);
        var partner = (await PartnerNamesAsync(new[] { order.PartnerId })).GetValueOrDefault(order.PartnerId) ?? "?";
        var bills = await _db.Bills.AsNoTracking()
            .Where(b => b.Lines.Any(l => l.PurchaseOrderLineId != null && lineIds.Contains(l.PurchaseOrderLineId.Value)))
            .OrderBy(b => b.IssueDate)
            .Select(b => new PurchaseOrderBillResponse(b.Id, b.VendorReference, b.IssueDate, b.State.ToString()))
            .ToListAsync();
        var lines = order.Lines.OrderBy(l => l.SortOrder).Select(l =>
        {
            var (posted, draft) = billed.GetValueOrDefault(l.Id);
            return new PurchaseOrderLineResponse(l.Id, l.ItemId, l.Description, l.Quantity, l.UnitPrice, l.TaxDefinitionId,
                posted, draft, Math.Max(0m, l.Quantity - posted), posted > l.Quantity,
                received.GetValueOrDefault(l.Id), Math.Max(0m, l.Quantity - received.GetValueOrDefault(l.Id)));
        }).ToList();
        return new PurchaseOrderResponse(order.Id, order.PartnerId, partner, order.Number, order.Date, order.ExpectedDate, order.WarehouseId,
            order.State, Progress(order, billed), order.VendorReference, order.Notes, order.ConfirmedAt, lines, bills);
    }
}
