using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Auth;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Companies;
using Pako.Domain.Hr;
using Pako.Domain.Pos;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md §6.8 / P7 — omnichannel: a webshop or marketplace reads a store's catalogue and
// sends orders through its channel token. Orders are accepted and picked in the back office, then
// fiscalised at the store's till — on collection (click & collect) or on dispatch to the courier,
// whose cash on delivery is tracked until the courier remits it.
[ApiController]
[Route("api/companies/{companyId:guid}/pos")]
[Authorize]
public class PosChannelsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PosChannelsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    public static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    // ---- Channels ----

    [HttpGet("channels", Name = "ListPosSalesChannels")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<List<SalesChannelResponse>>> Channels(Guid companyId)
    {
        var channels = await _db.PosSalesChannels.AsNoTracking().Where(c => c.CompanyId == companyId).OrderBy(c => c.Name).ToListAsync();
        var open = await _db.PosChannelOrders.AsNoTracking()
            .Where(o => o.CompanyId == companyId && (o.State == ChannelOrderState.New || o.State == ChannelOrderState.Accepted || o.State == ChannelOrderState.Ready))
            .GroupBy(o => o.ChannelId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
        return Ok(channels.Select(c => new SalesChannelResponse(c.Id, c.StoreId, c.Name, c.Kind, c.Token, c.IsActive, open.GetValueOrDefault(c.Id))).ToList());
    }

    [HttpPost("channels", Name = "CreatePosSalesChannel")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    [ProducesResponseType(typeof(SalesChannelResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<SalesChannelResponse>> CreateChannel(Guid companyId, SaveSalesChannelRequest request)
    {
        var channel = new SalesChannel { Id = Guid.NewGuid(), CompanyId = companyId, Token = NewToken() };
        if (await ApplyChannelAsync(companyId, channel, request) is { } error) return BadRequest(error);
        _db.PosSalesChannels.Add(channel);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, new SalesChannelResponse(channel.Id, channel.StoreId, channel.Name, channel.Kind, channel.Token, channel.IsActive, 0));
    }

    [HttpPut("channels/{channelId:guid}", Name = "UpdatePosSalesChannel")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<SalesChannelResponse>> UpdateChannel(Guid companyId, Guid channelId, SaveSalesChannelRequest request)
    {
        var channel = await _db.PosSalesChannels.FirstOrDefaultAsync(c => c.Id == channelId && c.CompanyId == companyId);
        if (channel is null) return NotFound();
        if (await ApplyChannelAsync(companyId, channel, request) is { } error) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(new SalesChannelResponse(channel.Id, channel.StoreId, channel.Name, channel.Kind, channel.Token, channel.IsActive, 0));
    }

    // A leaked token is replaced; the webshop must be given the new one.
    [HttpPost("channels/{channelId:guid}/token", Name = "RotatePosSalesChannelToken")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<SalesChannelResponse>> RotateToken(Guid companyId, Guid channelId)
    {
        var channel = await _db.PosSalesChannels.FirstOrDefaultAsync(c => c.Id == channelId && c.CompanyId == companyId);
        if (channel is null) return NotFound();
        channel.Token = NewToken();
        await _db.SaveChangesAsync();
        return Ok(new SalesChannelResponse(channel.Id, channel.StoreId, channel.Name, channel.Kind, channel.Token, channel.IsActive, 0));
    }

    private async Task<string?> ApplyChannelAsync(Guid companyId, SalesChannel channel, SaveSalesChannelRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 120) return _localizer["PosChannelInvalid"].Value;
        if (!await _db.PosStores.AnyAsync(s => s.Id == r.StoreId && s.CompanyId == companyId)) return _localizer["PosStoreNotFound"].Value;
        (channel.StoreId, channel.Name, channel.Kind, channel.IsActive) = (r.StoreId, r.Name.Trim(), r.Kind, r.IsActive);
        return null;
    }

    // ---- Orders ----

    [HttpGet("channel-orders", Name = "ListPosChannelOrders")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<PaginatedResponse<ChannelOrderResponse>>> Orders(Guid companyId, [FromQuery] Guid? storeId = null,
        [FromQuery] ChannelOrderState? state = null, [FromQuery] string? search = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = _db.PosChannelOrders.AsNoTracking().Where(o => o.CompanyId == companyId);
        if (storeId is { } s) query = query.Where(o => o.StoreId == s);
        if (state is { } st) query = query.Where(o => o.State == st);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(o => EF.Functions.ILike(o.Number, pattern) || EF.Functions.ILike(o.ExternalRef, pattern)
                || EF.Functions.ILike(o.CustomerName, pattern) || (o.Phone != null && EF.Functions.ILike(o.Phone, pattern))
                || (o.TrackingNumber != null && EF.Functions.ILike(o.TrackingNumber, pattern)));
        }
        var total = await query.CountAsync();
        var rows = await query.Include(o => o.Lines).OrderByDescending(o => o.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new PaginatedResponse<ChannelOrderResponse>(await ResponsesAsync(_db, rows), total, page, pageSize));
    }

    [HttpGet("channel-orders/{orderId:guid}", Name = "GetPosChannelOrder")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<ChannelOrderResponse>> Order(Guid companyId, Guid orderId)
    {
        var order = await _db.PosChannelOrders.AsNoTracking().Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == orderId && o.CompanyId == companyId);
        return order is null ? NotFound() : Ok((await ResponsesAsync(_db, new() { order }))[0]);
    }

    // The order's way through the shop: accepted, picked (ready), and after the till fiscalised and
    // dispatched it, delivered or brought back by the courier. Cancelled while not yet fiscalised.
    [HttpPost("channel-orders/{orderId:guid}/state", Name = "SetPosChannelOrderState")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Pos)]
    public async Task<ActionResult<ChannelOrderResponse>> SetState(Guid companyId, Guid orderId, ChannelOrderStateRequest request)
    {
        var order = await _db.PosChannelOrders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == orderId && o.CompanyId == companyId);
        if (order is null) return NotFound();
        var allowed = (order.State, request.State) switch
        {
            (ChannelOrderState.New, ChannelOrderState.Accepted) => true,
            (ChannelOrderState.New or ChannelOrderState.Accepted, ChannelOrderState.Ready) => true,
            (ChannelOrderState.New or ChannelOrderState.Accepted or ChannelOrderState.Ready, ChannelOrderState.Cancelled) => order.PosOrderId is null,
            (ChannelOrderState.Dispatched, ChannelOrderState.Completed or ChannelOrderState.Returned) => true,
            _ => false,
        };
        if (!allowed) return BadRequest(_localizer["PosChannelOrderStateInvalid"].Value);
        if (request.CourierPartnerId is { } courier)
        {
            if (order.Fulfilment != ChannelFulfilment.Delivery || !await _db.Partners.AnyAsync(p => p.Id == courier && p.CompanyId == companyId && p.IsCustomer))
            {
                return BadRequest(_localizer["PosCourierInvalid"].Value);
            }
            order.CourierPartnerId = courier;
        }
        if (!string.IsNullOrWhiteSpace(request.TrackingNumber)) order.TrackingNumber = request.TrackingNumber.Trim();
        // Cash on delivery is charged to the courier at the till: it must be named before dispatch.
        if (request.State == ChannelOrderState.Ready && order.Fulfilment == ChannelFulfilment.Delivery && order.Payment == ChannelPayment.CashOnDelivery
            && order.CourierPartnerId is null)
        {
            return BadRequest(_localizer["PosCourierRequired"].Value);
        }
        order.State = request.State;
        await _db.SaveChangesAsync();
        return Ok((await ResponsesAsync(_db, new() { order }))[0]);
    }

    // Cash on delivery the couriers hold: fiscalised orders paid to the courier and not remitted yet.
    [HttpGet("channel-orders/cod", Name = "GetPosCodReport")]
    [RequireCompanyAccess(module: AccessModule.Pos)]
    public async Task<ActionResult<CodReportResponse>> Cod(Guid companyId)
    {
        var orders = await _db.PosChannelOrders.AsNoTracking().Include(o => o.Lines)
            .Where(o => o.CompanyId == companyId && o.Payment == ChannelPayment.CashOnDelivery && o.PosOrderId != null && o.RemittedOn == null
                && (o.State == ChannelOrderState.Dispatched || o.State == ChannelOrderState.Completed))
            .OrderBy(o => o.CreatedAt).ToListAsync();
        var responses = await ResponsesAsync(_db, orders);
        var amounts = await CodAmountsAsync(orders);
        var couriers = responses.Where(o => o.CourierPartnerId != null).GroupBy(o => (o.CourierPartnerId!.Value, o.CourierName ?? "?"))
            .Select(g => new CodCourierRow(g.Key.Value, g.Key.Item2, g.Count(), g.Sum(o => amounts.GetValueOrDefault(o.Id)),
                DateOnly.FromDateTime(PosService.LocalTime(g.Min(o => o.CreatedAt))))).OrderBy(c => c.CourierName).ToList();
        return Ok(new CodReportResponse(couriers, responses));
    }

    // What the till charged each order's courier.
    private async Task<Dictionary<Guid, decimal>> CodAmountsAsync(List<ChannelOrder> orders)
    {
        var posIds = orders.Where(o => o.PosOrderId != null).Select(o => o.PosOrderId!.Value).ToList();
        var paid = await _db.PosPayments.AsNoTracking().Where(p => posIds.Contains(p.OrderId) && p.PartnerId != null)
            .GroupBy(p => p.OrderId).Select(g => new { g.Key, Amount = g.Sum(p => p.Amount) }).ToDictionaryAsync(g => g.Key, g => g.Amount);
        return orders.ToDictionary(o => o.Id, o => o.PosOrderId is { } id ? paid.GetValueOrDefault(id) : 0m);
    }

    // The courier's statement arrived: these orders' cash was paid over (the bank receipt itself is
    // recorded against the courier's balance in the usual way).
    [HttpPost("channel-orders/cod/remit", Name = "RemitPosCod")]
    [RequireCompanyAccess(module: AccessModule.Pos, approve: true)]
    public async Task<ActionResult<CodReportResponse>> Remit(Guid companyId, CodRemittanceRequest request)
    {
        if (request.OrderIds is null || request.OrderIds.Count == 0 || string.IsNullOrWhiteSpace(request.Reference)) return BadRequest(_localizer["PosCodRemitInvalid"].Value);
        var orders = await _db.PosChannelOrders.Where(o => o.CompanyId == companyId && request.OrderIds.Contains(o.Id)).ToListAsync();
        if (orders.Count != request.OrderIds.Distinct().Count()
            || orders.Any(o => o.Payment != ChannelPayment.CashOnDelivery || o.PosOrderId is null || o.RemittedOn != null))
        {
            return BadRequest(_localizer["PosCodRemitInvalid"].Value);
        }
        foreach (var o in orders) (o.RemittedOn, o.RemittanceRef) = (request.RemittedOn, request.Reference.Trim());
        await _db.SaveChangesAsync();
        return await Cod(companyId);
    }

    public static async Task<List<ChannelOrderResponse>> ResponsesAsync(PakoDbContext db, List<ChannelOrder> orders)
    {
        var channelIds = orders.Select(o => o.ChannelId).Distinct().ToList();
        var channels = await db.PosSalesChannels.AsNoTracking().Where(c => channelIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name);
        var courierIds = orders.Where(o => o.CourierPartnerId != null).Select(o => o.CourierPartnerId!.Value).Distinct().ToList();
        var couriers = await db.Partners.AsNoTracking().Where(p => courierIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        var posIds = orders.Where(o => o.PosOrderId != null).Select(o => o.PosOrderId!.Value).ToList();
        var posNumbers = await db.PosOrders.AsNoTracking().Where(o => posIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id, o => o.Number);
        return orders.Select(o => new ChannelOrderResponse(o.Id, o.ChannelId, channels.GetValueOrDefault(o.ChannelId) ?? "?", o.StoreId, o.Number, o.ExternalRef,
            o.State, o.Fulfilment, o.Payment, o.CustomerName, o.Phone, o.Email, o.Address, o.City, o.Notes, o.Total, o.ShippingFee, o.CourierPartnerId,
            o.CourierPartnerId is { } c ? couriers.GetValueOrDefault(c) : null, o.TrackingNumber, o.PosOrderId,
            o.PosOrderId is { } p ? posNumbers.GetValueOrDefault(p) : null, o.RemittedOn, o.RemittanceRef, o.CreatedAt,
            o.Lines.OrderBy(l => l.LineNo).Select(l => new ChannelOrderLineResponse(l.Id, l.LineNo, l.ItemId, l.Description, l.Quantity, l.UnitPrice,
                PosPricing.Money(l.Quantity * l.UnitPrice))).ToList())).ToList();
    }
}

// The public side of a channel: the catalogue with prices and what can be sold, and order intake.
// A resent order (same external reference) is answered with the one already taken.
[ApiController]
[Route("api/public/channel/{token}")]
[AllowAnonymous]
[EnableRateLimiting(AuthRateLimit.Policy)]
public class PublicChannelController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly PriceListService _prices;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PublicChannelController(PakoDbContext db, PriceListService prices, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _prices = prices;
        _localizer = localizer;
    }

    private async Task<(SalesChannel Channel, Store Store)?> ChannelAsync(string token)
    {
        var channel = await _db.PosSalesChannels.AsNoTracking().FirstOrDefaultAsync(c => c.Token == token && c.IsActive);
        if (channel is null) return null;
        var store = await _db.PosStores.AsNoTracking().FirstOrDefaultAsync(s => s.Id == channel.StoreId && s.IsActive);
        var company = await _db.Companies.AsNoTracking().FirstAsync(c => c.Id == channel.CompanyId);
        return store is null || !company.EnabledModules.HasFlag(AppModule.Pos) ? null : (channel, store);
    }

    // Priced items with what is free to sell: on hand in the store less what open channel orders hold.
    [HttpGet("catalog", Name = "GetPublicChannelCatalog")]
    public async Task<ActionResult<PaginatedResponse<PublicCatalogItem>>> Catalog(string token, [FromQuery] int page = 1, [FromQuery] int pageSize = 100)
    {
        if (await ChannelAsync(token) is not { } found) return NotFound();
        var (channel, store) = found;
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 500);
        var query = _db.Items.AsNoTracking().Where(i => i.CompanyId == channel.CompanyId && !i.IsVariantTemplate && i.AgencyPartnerId == null
            && !i.IsPrescriptionOnly);
        var total = await query.CountAsync();
        var items = await query.OrderBy(i => i.Code).Skip((page - 1) * pageSize).Take(pageSize).Include(i => i.Barcodes).ToListAsync();
        var ids = items.Select(i => i.Id).ToList();
        var prices = (await _prices.ResolveAsync(channel.CompanyId, store.WarehouseId, DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow)), ids, store.PriceListId))
            .ToDictionary(p => p.ItemId, p => p.Price);
        var location = await new StockService(_db, _localizer).StockLocationAsync(channel.CompanyId, store.WarehouseId);
        var onHand = await _db.StockBalances.AsNoTracking().Where(b => b.LocationId == location.Id && ids.Contains(b.ItemId)).ToDictionaryAsync(b => b.ItemId, b => b.Quantity);
        var held = await _db.PosChannelOrderLines.AsNoTracking()
            .Where(l => ids.Contains(l.ItemId) && _db.PosChannelOrders.Any(o => o.Id == l.ChannelOrderId && o.StoreId == store.Id
                && (o.State == ChannelOrderState.New || o.State == ChannelOrderState.Accepted || o.State == ChannelOrderState.Ready)))
            .GroupBy(l => l.ItemId).Select(g => new { g.Key, Quantity = g.Sum(l => l.Quantity) }).ToDictionaryAsync(g => g.Key, g => g.Quantity);
        return Ok(new PaginatedResponse<PublicCatalogItem>(items.Select(i => new PublicCatalogItem(i.Id, i.Code, i.Name, i.Unit,
            i.Barcodes.Select(b => b.Barcode).ToList(), prices.TryGetValue(i.Id, out var p) ? p : null,
            i.TrackInventory ? Math.Max(0m, onHand.GetValueOrDefault(i.Id) - held.GetValueOrDefault(i.Id)) : 9999m)).ToList(), total, page, pageSize));
    }

    [HttpPost("orders", Name = "CreatePublicChannelOrder")]
    [ProducesResponseType(typeof(PublicChannelOrderResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PublicChannelOrderResponse>> CreateOrder(string token, PublicChannelOrderRequest request)
    {
        if (await ChannelAsync(token) is not { } found) return NotFound();
        var (channel, store) = found;
        if (string.IsNullOrWhiteSpace(request.ExternalRef) || request.ExternalRef.Trim().Length > 64 || string.IsNullOrWhiteSpace(request.CustomerName)
            || request.Lines is null || request.Lines.Count is 0 or > 200 || request.Lines.Any(l => l.Quantity <= 0 || l.UnitPrice < 0) || request.ShippingFee < 0
            || (request.Fulfilment == ChannelFulfilment.Delivery && string.IsNullOrWhiteSpace(request.Address))
            || (request.Fulfilment == ChannelFulfilment.Pickup && request.Payment == ChannelPayment.CashOnDelivery))
        {
            return BadRequest(_localizer["PosChannelOrderInvalid"].Value);
        }
        var externalRef = request.ExternalRef.Trim();
        var existing = await _db.PosChannelOrders.AsNoTracking().FirstOrDefaultAsync(o => o.ChannelId == channel.Id && o.ExternalRef == externalRef);
        if (existing is not null) return Ok(new PublicChannelOrderResponse(existing.Number, existing.ExternalRef, existing.State, existing.Total, existing.TrackingNumber));

        var itemIds = request.Lines.Select(l => l.ItemId).Distinct().ToList();
        var items = await _db.Items.AsNoTracking().Where(i => i.CompanyId == channel.CompanyId && itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
        if (items.Count != itemIds.Count || items.Values.Any(i => i.IsPrescriptionOnly || i.AgencyPartnerId != null)) return BadRequest(_localizer["PosChannelOrderInvalid"].Value);

        var count = await _db.PosChannelOrders.CountAsync(o => o.CompanyId == channel.CompanyId);
        var order = new ChannelOrder
        {
            Id = Guid.NewGuid(), CompanyId = channel.CompanyId, ChannelId = channel.Id, StoreId = store.Id, Number = $"WEB-{count + 1:D5}", ExternalRef = externalRef,
            State = ChannelOrderState.New, Fulfilment = request.Fulfilment, Payment = request.Payment, CustomerName = request.CustomerName.Trim(),
            Phone = Blank(request.Phone), Email = Blank(request.Email), Address = Blank(request.Address), City = Blank(request.City), Notes = Blank(request.Notes),
            ShippingFee = PosPricing.Money(request.ShippingFee),
        };
        order.Lines = request.Lines.Select((l, i) => new ChannelOrderLine
        {
            Id = Guid.NewGuid(), ChannelOrderId = order.Id, LineNo = i + 1, ItemId = l.ItemId,
            Description = string.IsNullOrWhiteSpace(l.Description) ? items[l.ItemId].Name : l.Description.Trim()[..Math.Min(512, l.Description.Trim().Length)],
            Quantity = l.Quantity, UnitPrice = l.UnitPrice,
        }).ToList();
        order.Total = order.Lines.Sum(l => PosPricing.Money(l.Quantity * l.UnitPrice)) + order.ShippingFee;
        _db.PosChannelOrders.Add(order);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Sent twice at once: the other request took it.
            _db.ChangeTracker.Clear();
            var taken = await _db.PosChannelOrders.AsNoTracking().FirstAsync(o => o.ChannelId == channel.Id && o.ExternalRef == externalRef);
            return Ok(new PublicChannelOrderResponse(taken.Number, taken.ExternalRef, taken.State, taken.Total, taken.TrackingNumber));
        }
        return StatusCode(StatusCodes.Status201Created, new PublicChannelOrderResponse(order.Number, order.ExternalRef, order.State, order.Total, order.TrackingNumber));
    }

    [HttpGet("orders/{externalRef}", Name = "GetPublicChannelOrder")]
    public async Task<ActionResult<PublicChannelOrderResponse>> GetOrder(string token, string externalRef)
    {
        if (await ChannelAsync(token) is not { } found) return NotFound();
        var order = await _db.PosChannelOrders.AsNoTracking().FirstOrDefaultAsync(o => o.ChannelId == found.Channel.Id && o.ExternalRef == externalRef);
        return order is null ? NotFound() : Ok(new PublicChannelOrderResponse(order.Number, order.ExternalRef, order.State, order.Total, order.TrackingNumber));
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
