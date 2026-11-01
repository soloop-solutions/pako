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
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md P2: layaway and special orders. Pos: Write takes orders and marks them ready;
// collecting happens at the till (a sale naming the order); cancelling with a refund needs Approve.
[ApiController]
[Route("api/companies/{companyId:guid}/pos/customer-orders")]
[Authorize]
public class CustomerOrdersController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public CustomerOrdersController(PakoDbContext db, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _localizer = localizer;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet(Name = "ListCustomerOrders")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PaginatedResponse<CustomerOrderResponse>>> List(Guid companyId, [FromQuery] CustomerOrderState? state = null,
        [FromQuery] string? search = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.PosCustomerOrders.AsNoTracking().Include(o => o.Lines).Where(o => o.CompanyId == companyId);
        if (state is { } s) query = query.Where(o => o.State == s);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search.Trim()}%";
            query = query.Where(o => EF.Functions.ILike(o.Number, term) || _db.Partners.Any(p => p.Id == o.CustomerId && EF.Functions.ILike(p.Name, term)));
        }
        var total = await query.CountAsync();
        var orders = await query.OrderByDescending(o => o.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new PaginatedResponse<CustomerOrderResponse>(await ToResponsesAsync(orders), total, page, pageSize));
    }

    [HttpGet("{id:guid}", Name = "GetCustomerOrder")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<CustomerOrderResponse>> Get(Guid companyId, Guid id)
    {
        var order = await _db.PosCustomerOrders.AsNoTracking().Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id && o.CompanyId == companyId);
        return order is null ? NotFound() : Ok((await ToResponsesAsync(new List<CustomerOrder> { order }))[0]);
    }

    [HttpPost(Name = "CreateCustomerOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    [ProducesResponseType(typeof(CustomerOrderResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<CustomerOrderResponse>> Create(Guid companyId, SaveCustomerOrderRequest request)
    {
        // Numbered CO-00001 per company; the deposit card carries the same number.
        var count = await _db.PosCustomerOrders.CountAsync(o => o.CompanyId == companyId);
        var number = $"CO-{count + 1:D5}";
        var card = new GiftCard { Id = Guid.NewGuid(), CompanyId = companyId, Number = number, Kind = GiftCardKind.Deposit, PartnerId = request.CustomerId };
        var order = new CustomerOrder { Id = Guid.NewGuid(), CompanyId = companyId, Number = number, DepositCardId = card.Id, State = CustomerOrderState.Open };
        if (await ApplyAsync(companyId, order, request) is { } error) return BadRequest(error);
        _db.GiftCards.Add(card);
        _db.PosCustomerOrders.Add(order);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await ToResponsesAsync(new List<CustomerOrder> { order }))[0]);
    }

    [HttpPut("{id:guid}", Name = "UpdateCustomerOrder")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<CustomerOrderResponse>> Update(Guid companyId, Guid id, SaveCustomerOrderRequest request)
    {
        var order = await _db.PosCustomerOrders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id && o.CompanyId == companyId);
        if (order is null) return NotFound();
        if (order.State is CustomerOrderState.Collected or CustomerOrderState.Cancelled) return BadRequest(_localizer["CustomerOrderClosed"].Value);
        if (await ApplyAsync(companyId, order, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(new List<CustomerOrder> { order }))[0]);
    }

    // The goods are in: the customer can come for them.
    [HttpPost("{id:guid}/ready", Name = "MarkCustomerOrderReady")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<CustomerOrderResponse>> Ready(Guid companyId, Guid id)
    {
        var order = await _db.PosCustomerOrders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id && o.CompanyId == companyId);
        if (order is null) return NotFound();
        if (order.State != CustomerOrderState.Open) return BadRequest(_localizer["CustomerOrderClosed"].Value);
        order.State = CustomerOrderState.Ready;
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(new List<CustomerOrder> { order }))[0]);
    }

    // Cancelled orders pay their deposits back in cash, from an open session's drawer (a paid-out
    // against the deposit liability, under the customer).
    [HttpPost("{id:guid}/cancel", Name = "CancelCustomerOrder")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<CustomerOrderResponse>> Cancel(Guid companyId, Guid id, CancelCustomerOrderRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Reason)) return BadRequest(_localizer["PosReasonRequired"].Value);
        await using var transaction = _db.Database.SupportsRowLocking() ? await _db.Database.BeginTransactionAsync() : null;
        if (transaction is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM companies WHERE \"Id\" = {companyId} FOR UPDATE");
        }
        var order = await _db.PosCustomerOrders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id && o.CompanyId == companyId);
        if (order is null) return NotFound();
        if (order.State is CustomerOrderState.Collected or CustomerOrderState.Cancelled) return BadRequest(_localizer["CustomerOrderClosed"].Value);
        var card = await _db.GiftCards.FirstAsync(c => c.Id == order.DepositCardId);
        if (card.Balance > 0)
        {
            var session = request.SessionId is { } sid
                ? await _db.PosSessions.FirstOrDefaultAsync(s => s.Id == sid && s.CompanyId == companyId && s.State == PosSessionState.Open)
                : null;
            if (session is null) return BadRequest(_localizer["CustomerOrderRefundNeedsSession"].Value);
            var liability = await _db.PaymentMethods.AsNoTracking().Where(m => m.CompanyId == companyId && m.Kind == PaymentMethodKind.GiftCard)
                .OrderBy(m => m.Name).Select(m => (Guid?)m.LedgerAccountId).FirstOrDefaultAsync();
            if (liability is null) return BadRequest(_localizer["PosGiftCardNotSetUp"].Value);
            _db.PosCashMovements.Add(new PosCashMovement
            {
                Id = Guid.NewGuid(), SessionId = session.Id, Kind = PosCashMovementKind.PaidOut, Amount = card.Balance,
                Reason = $"{order.Number} · {request.Reason.Trim()}", CounterpartAccountId = liability.Value, PartnerId = order.CustomerId,
                CreatedByUserId = CurrentUserId,
            });
            _db.GiftCardMovements.Add(new GiftCardMovement { Id = Guid.NewGuid(), GiftCardId = card.Id, Amount = -card.Balance });
            card.Balance = 0;
        }
        card.IsActive = false;
        order.State = CustomerOrderState.Cancelled;
        order.Notes = string.IsNullOrWhiteSpace(order.Notes) ? request.Reason.Trim() : $"{order.Notes}\n{request.Reason.Trim()}";
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
        return Ok((await ToResponsesAsync(new List<CustomerOrder> { order }))[0]);
    }

    private async Task<string?> ApplyAsync(Guid companyId, CustomerOrder order, SaveCustomerOrderRequest r)
    {
        if (r.Lines is null || r.Lines.Count == 0 || r.Lines.Any(l => l.Quantity <= 0 || l.UnitPrice is < 0)) return _localizer["CustomerOrderLinesInvalid"].Value;
        var store = await _db.PosStores.AsNoTracking().FirstOrDefaultAsync(s => s.Id == r.StoreId && s.CompanyId == companyId);
        if (store is null) return _localizer["PosStoreNotFound"].Value;
        if (!await _db.Partners.AnyAsync(p => p.Id == r.CustomerId && p.CompanyId == companyId && p.IsCustomer)) return _localizer["PosCustomerNotFound"].Value;
        var itemIds = r.Lines.Select(l => l.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == companyId && itemIds.Contains(i.Id) && !i.IsVariantTemplate).ToDictionaryAsync(i => i.Id);
        if (items.Count != itemIds.Count) return _localizer["PosItemNotFound"].Value;
        var prices = (await _prices.ResolveAsync(companyId, store.WarehouseId, DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)), itemIds, store.PriceListId))
            .ToDictionary(p => p.ItemId, p => p.Price);
        if (r.Lines.Any(l => l.UnitPrice is null && !prices.ContainsKey(l.ItemId))) return _localizer["CustomerOrderPriceMissing"].Value;

        (order.StoreId, order.Kind, order.CustomerId, order.DueDate) = (store.Id, r.Kind, r.CustomerId, r.DueDate);
        order.Notes = string.IsNullOrWhiteSpace(r.Notes) ? null : r.Notes.Trim();
        _db.PosCustomerOrderLines.RemoveRange(order.Lines);
        order.Lines = r.Lines.Select((l, i) => new CustomerOrderLine
        {
            Id = Guid.NewGuid(), CustomerOrderId = order.Id, LineNo = i + 1, ItemId = l.ItemId,
            Description = string.IsNullOrWhiteSpace(l.Description) ? items[l.ItemId].Name : l.Description.Trim(),
            Quantity = l.Quantity, UnitPrice = l.UnitPrice ?? prices[l.ItemId],
        }).ToList();
        if (_db.Entry(order).State != EntityState.Detached) _db.PosCustomerOrderLines.AddRange(order.Lines);
        return null;
    }

    private async Task<List<CustomerOrderResponse>> ToResponsesAsync(List<CustomerOrder> orders)
    {
        var cardIds = orders.Select(o => o.DepositCardId).ToList();
        var cards = await _db.GiftCards.AsNoTracking().Where(c => cardIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        var deposited = await _db.GiftCardMovements.AsNoTracking().Where(m => cardIds.Contains(m.GiftCardId) && m.Amount > 0)
            .GroupBy(m => m.GiftCardId).Select(g => new { g.Key, Amount = g.Sum(m => m.Amount) }).ToDictionaryAsync(g => g.Key, g => g.Amount);
        var customerIds = orders.Select(o => o.CustomerId).Distinct().ToList();
        var names = await _db.Partners.AsNoTracking().Where(p => customerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        return orders.Select(o =>
        {
            var lines = o.Lines.OrderBy(l => l.LineNo)
                .Select(l => new CustomerOrderLineResponse(l.Id, l.ItemId, l.Description, l.Quantity, l.UnitPrice, PosPricing.Money(l.Quantity * l.UnitPrice))).ToList();
            var total = lines.Sum(l => l.Amount);
            var card = cards.GetValueOrDefault(o.DepositCardId);
            return new CustomerOrderResponse(o.Id, o.Number, o.Kind, o.State, o.CustomerId, names.GetValueOrDefault(o.CustomerId) ?? "?", o.StoreId, o.DueDate,
                o.Notes, lines, total, card?.Number ?? o.Number, deposited.GetValueOrDefault(o.DepositCardId),
                Math.Max(0m, total - (card?.Balance ?? 0m)), o.CreatedAt, o.CollectedOrderId);
        }).ToList();
    }
}
