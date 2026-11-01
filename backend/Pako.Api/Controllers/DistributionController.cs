using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Inventory;
using Pako.Domain.Invoicing;
using Pako.Infrastructure;

namespace Pako.Api.Controllers;

// docs/POS_PLAN.md §6.10 / P6 — distribution: sales routes, visits checked in on the spot, what to
// load on a van and the van's settlement at the end of the day. Loading and unloading are ordinary
// stock transfers into and out of the van's warehouse; selling from the van is an invoice (B2B) or a
// POS coupon from a store whose warehouse is the van.
[ApiController]
[Route("api/companies/{companyId:guid}/distribution")]
[Authorize]
public class DistributionController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;
    private readonly CompanyAccessContext _access;
    private readonly SalesCreditService _credit;
    private readonly StockService _stock;

    public DistributionController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer, CompanyAccessContext access, SalesCreditService credit,
        StockService stock)
    {
        _db = db;
        _localizer = localizer;
        _access = access;
        _credit = credit;
        _stock = stock;
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static DateOnly Today => DateOnly.FromDateTime(PosService.LocalTime(DateTime.UtcNow));

    // Monday = bit 0.
    private static int DayBit(DateOnly date) => 1 << (((int)date.DayOfWeek + 6) % 7);

    // ---- Routes ----

    [HttpGet("routes", Name = "ListSalesRoutes")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<SalesRouteResponse>>> Routes(Guid companyId)
    {
        var routes = await _db.SalesRoutes.AsNoTracking().Include(r => r.Stops).Where(r => r.CompanyId == companyId).OrderBy(r => r.Name).ToListAsync();
        return Ok(await ToResponsesAsync(routes));
    }

    [HttpPost("routes", Name = "CreateSalesRoute")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(SalesRouteResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<SalesRouteResponse>> CreateRoute(Guid companyId, SaveSalesRouteRequest request)
    {
        if (await ValidateRouteAsync(companyId, null, request) is { } error) return BadRequest(error);
        var route = new SalesRoute { Id = Guid.NewGuid(), CompanyId = companyId };
        ApplyRoute(route, request);
        _db.SalesRoutes.Add(route);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await ToResponsesAsync(new() { route }))[0]);
    }

    [HttpPut("routes/{routeId:guid}", Name = "UpdateSalesRoute")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<SalesRouteResponse>> UpdateRoute(Guid companyId, Guid routeId, SaveSalesRouteRequest request)
    {
        var route = await _db.SalesRoutes.Include(r => r.Stops).FirstOrDefaultAsync(r => r.Id == routeId && r.CompanyId == companyId);
        if (route is null) return NotFound();
        if (await ValidateRouteAsync(companyId, routeId, request) is { } error) return BadRequest(error);
        _db.SalesRouteStops.RemoveRange(route.Stops);
        ApplyRoute(route, request);
        _db.SalesRouteStops.AddRange(route.Stops);
        await _db.SaveChangesAsync();
        return Ok((await ToResponsesAsync(new() { route }))[0]);
    }

    private async Task<string?> ValidateRouteAsync(Guid companyId, Guid? id, SaveSalesRouteRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 120) return _localizer["SalesRouteName"].Value;
        if (await _db.SalesRoutes.AnyAsync(r => r.CompanyId == companyId && r.Id != id && r.Name == request.Name.Trim())) return _localizer["SalesRouteNameTaken"].Value;
        if (request.Days is < 0 or > 127) return _localizer["SalesRouteDays"].Value;
        if (request.WarehouseId is { } w && !await _db.Warehouses.AnyAsync(x => x.Id == w && x.CompanyId == companyId && x.IsActive))
        {
            return _localizer["WarehouseNotFound"].Value;
        }
        var stops = request.Stops ?? new();
        if (stops.Count > 500) return _localizer["StockDocumentTooManyLines"].Value;
        var partnerIds = stops.Select(s => s.PartnerId).Distinct().ToList();
        if (partnerIds.Count != stops.Count) return _localizer["SalesRouteDuplicateStop"].Value;
        if (await _db.Partners.CountAsync(p => p.CompanyId == companyId && p.IsCustomer && partnerIds.Contains(p.Id)) != partnerIds.Count)
        {
            return _localizer["InvalidCustomerPartner"].Value;
        }
        return null;
    }

    private static void ApplyRoute(SalesRoute route, SaveSalesRouteRequest request)
    {
        route.Name = request.Name.Trim();
        route.UserId = request.UserId;
        route.WarehouseId = request.WarehouseId;
        route.Days = request.Days;
        route.IsActive = request.IsActive;
        route.Stops = (request.Stops ?? new()).Select((s, i) => new SalesRouteStop
        {
            Id = Guid.NewGuid(), RouteId = route.Id, PartnerId = s.PartnerId, Sequence = i + 1,
            Notes = string.IsNullOrWhiteSpace(s.Notes) ? null : s.Notes.Trim(),
        }).ToList();
    }

    private async Task<List<SalesRouteResponse>> ToResponsesAsync(List<SalesRoute> routes)
    {
        var partnerIds = routes.SelectMany(r => r.Stops).Select(s => s.PartnerId).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        var warehouseIds = routes.Where(r => r.WarehouseId != null).Select(r => r.WarehouseId!.Value).ToList();
        var warehouses = await _db.Warehouses.AsNoTracking().Where(w => warehouseIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id, w => w.Name);
        return routes.Select(r => new SalesRouteResponse(r.Id, r.Name, r.UserId, r.WarehouseId,
            r.WarehouseId is { } w ? warehouses.GetValueOrDefault(w) : null, r.Days, r.IsActive,
            r.Stops.OrderBy(s => s.Sequence).Select(s => new SalesRouteStopResponse(s.Id, s.PartnerId, partners.GetValueOrDefault(s.PartnerId) ?? "?",
                s.Sequence, s.Notes)).ToList())).ToList();
    }

    // The signed-in member's routes running on the day, each stop with its visit and what the
    // customer owes — the salesperson's list for the day.
    [HttpGet("my-day", Name = "GetMyRouteDay")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<List<RouteDayResponse>>> MyDay(Guid companyId, [FromQuery] DateOnly? date = null)
    {
        var day = date ?? Today;
        var bit = DayBit(day);
        var routes = await _db.SalesRoutes.AsNoTracking().Include(r => r.Stops)
            .Where(r => r.CompanyId == companyId && r.IsActive && r.UserId == CurrentUserId && (r.Days & bit) != 0)
            .OrderBy(r => r.Name).ToListAsync();
        var partnerIds = routes.SelectMany(r => r.Stops).Select(s => s.PartnerId).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        var visits = await _db.RouteVisits.AsNoTracking()
            .Where(v => v.CompanyId == companyId && v.Date == day && v.UserId == CurrentUserId && partnerIds.Contains(v.PartnerId))
            .ToListAsync();
        var credit = new Dictionary<Guid, CreditStatusResponse?>();
        foreach (var id in partnerIds) credit[id] = await _credit.StatusAsync(companyId, id);

        return Ok(routes.Select(r => new RouteDayResponse(r.Id, r.Name, r.WarehouseId, day, r.Stops.OrderBy(s => s.Sequence).Select(s =>
        {
            var visit = visits.Where(v => v.PartnerId == s.PartnerId).OrderByDescending(v => v.CheckInAt).FirstOrDefault();
            var c = credit.GetValueOrDefault(s.PartnerId);
            return new RouteDayStopResponse(s.PartnerId, partners.GetValueOrDefault(s.PartnerId) ?? "?", s.Sequence, s.Notes, visit?.Id, visit?.Outcome,
                c?.Outstanding ?? 0m, c?.Overdue ?? 0m, c?.OverdueBlocked ?? false, visit?.Collected ?? 0m, visit?.Notes, visit?.CheckOutAt);
        }).ToList())).ToList());
    }

    // ---- Visits ----

    // Checked in at the customer's door, with the device's position when it gave one.
    [HttpPost("visits", Name = "CheckInRouteVisit")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    [ProducesResponseType(typeof(RouteVisitResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<RouteVisitResponse>> CheckIn(Guid companyId, CheckInRequest request)
    {
        if (!await _db.Partners.AnyAsync(p => p.Id == request.PartnerId && p.CompanyId == companyId && p.IsCustomer) || !_access.CanSeePartner(request.PartnerId))
        {
            return BadRequest(_localizer["InvalidCustomerPartner"].Value);
        }
        if (request.RouteId is { } routeId && !await _db.SalesRoutes.AnyAsync(r => r.Id == routeId && r.CompanyId == companyId))
        {
            return BadRequest(_localizer["SalesRouteNotFound"].Value);
        }
        if (request.Latitude is < -90 or > 90 || request.Longitude is < -180 or > 180 || request.AccuracyMeters is < 0)
        {
            return BadRequest(_localizer["RouteVisitPosition"].Value);
        }
        var visit = new RouteVisit
        {
            Id = Guid.NewGuid(), CompanyId = companyId, RouteId = request.RouteId, PartnerId = request.PartnerId, UserId = CurrentUserId, Date = Today,
            Latitude = request.Latitude, Longitude = request.Longitude, AccuracyMeters = request.AccuracyMeters, Outcome = RouteVisitOutcome.Open,
        };
        _db.RouteVisits.Add(visit);
        await _db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, (await VisitResponsesAsync(new() { visit }))[0]);
    }

    // What came of the visit; only the member who checked in records it.
    [HttpPut("visits/{visitId:guid}", Name = "UpdateRouteVisit")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Sales)]
    public async Task<ActionResult<RouteVisitResponse>> UpdateVisit(Guid companyId, Guid visitId, UpdateVisitRequest request)
    {
        var visit = await _db.RouteVisits.FirstOrDefaultAsync(v => v.Id == visitId && v.CompanyId == companyId);
        if (visit is null) return NotFound();
        if (visit.UserId != CurrentUserId) return Forbid();
        if (request.Collected is < 0 or > 1_000_000_000m) return BadRequest(_localizer["RouteVisitCollected"].Value);
        visit.Outcome = request.Outcome;
        visit.Collected = Math.Round(request.Collected, 2, MidpointRounding.AwayFromZero);
        visit.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim()[..Math.Min(1000, request.Notes.Trim().Length)];
        if (request.CheckOut) visit.CheckOutAt ??= DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok((await VisitResponsesAsync(new() { visit }))[0]);
    }

    // Visits on a day (everyone's, or one member's) with the field KPIs.
    [HttpGet("visits", Name = "ListRouteVisits")]
    [RequireCompanyAccess(module: AccessModule.Sales)]
    public async Task<ActionResult<VisitSummaryResponse>> Visits(Guid companyId, [FromQuery] DateOnly? date = null, [FromQuery] Guid? userId = null)
    {
        var day = date ?? Today;
        var query = _db.RouteVisits.AsNoTracking().Where(v => v.CompanyId == companyId && v.Date == day);
        if (userId is { } u) query = query.Where(v => v.UserId == u);
        if (_access.VisiblePartnerIds is { } visible) query = query.Where(v => visible.Contains(v.PartnerId));
        var visits = await query.OrderBy(v => v.CheckInAt).ToListAsync();
        var items = await VisitResponsesAsync(visits);
        var withOrder = visits.Count(v => v.Outcome is RouteVisitOutcome.Order or RouteVisitOutcome.Sale);
        var visitIds = visits.Select(v => v.Id).ToList();
        var orderValue = (await _db.SalesOrders.AsNoTracking().Include(o => o.Lines)
                .Where(o => o.RouteVisitId != null && visitIds.Contains(o.RouteVisitId.Value) && o.State != SalesOrderState.Cancelled).ToListAsync())
            .Sum(o => o.Lines.Sum(l => l.Gross));
        return Ok(new VisitSummaryResponse(visits.Count, withOrder,
            visits.Count == 0 ? 0m : Math.Round((decimal)withOrder / visits.Count, 4),
            orderValue, withOrder == 0 ? 0m : Math.Round(orderValue / withOrder, 2, MidpointRounding.AwayFromZero), visits.Sum(v => v.Collected), items));
    }

    private async Task<List<RouteVisitResponse>> VisitResponsesAsync(List<RouteVisit> visits)
    {
        var partnerIds = visits.Select(v => v.PartnerId).Distinct().ToList();
        var partners = await _db.Partners.AsNoTracking().Where(p => partnerIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name);
        var ids = visits.Select(v => v.Id).ToList();
        var orders = await _db.SalesOrders.AsNoTracking().Where(o => o.RouteVisitId != null && ids.Contains(o.RouteVisitId.Value))
            .Select(o => new { o.Id, VisitId = o.RouteVisitId!.Value, Number = o.Number ?? o.QuoteNumber }).ToListAsync();
        return visits.Select(v => new RouteVisitResponse(v.Id, v.RouteId, v.PartnerId, partners.GetValueOrDefault(v.PartnerId) ?? "?", v.UserId, v.Date,
            v.CheckInAt, v.CheckOutAt, v.Latitude, v.Longitude, v.AccuracyMeters, v.Outcome, v.Collected, v.Notes,
            orders.Where(o => o.VisitId == v.Id).Select(o => o.Id).ToList(), orders.Where(o => o.VisitId == v.Id).Select(o => o.Number).ToList())).ToList();
    }

    // ---- Vans ----

    private async Task<Warehouse?> VanAsync(Guid companyId, Guid warehouseId) =>
        await _db.Warehouses.AsNoTracking().FirstOrDefaultAsync(w => w.Id == warehouseId && w.CompanyId == companyId && w.IsVan);

    // The morning load: what confirmed orders of the customers on the van's routes that day still
    // wait for, less what is already on the van.
    [HttpGet("vans/{warehouseId:guid}/load", Name = "GetVanLoad")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<List<VanLoadLineResponse>>> Load(Guid companyId, Guid warehouseId, [FromQuery] DateOnly? date = null)
    {
        var van = await VanAsync(companyId, warehouseId);
        if (van is null) return NotFound();
        var day = date ?? Today;
        var bit = DayBit(day);
        var customers = await _db.SalesRouteStops.AsNoTracking()
            .Where(s => _db.SalesRoutes.Any(r => r.Id == s.RouteId && r.CompanyId == companyId && r.IsActive && r.WarehouseId == warehouseId && (r.Days & bit) != 0))
            .Select(s => s.PartnerId).Distinct().ToListAsync();
        var lines = await _db.SalesOrderLines.AsNoTracking()
            .Where(l => l.ItemId != null && l.SalesOrder!.CompanyId == companyId && l.SalesOrder.State == SalesOrderState.Confirmed
                && customers.Contains(l.SalesOrder.PartnerId) && (l.SalesOrder.DeliveryDate == null || l.SalesOrder.DeliveryDate <= day))
            .ToListAsync();
        var delivered = await SalesOrderQuantities.DeliveredAsync(_db, lines.Select(l => l.Id).ToList(), includeDrafts: true);
        var ordered = lines.GroupBy(l => l.ItemId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(l => Math.Max(0m, l.BaseQuantity - delivered.GetValueOrDefault(l.Id))));
        var tracked = await _stock.TrackedItemsAsync(companyId, ordered.Keys.Cast<Guid?>());
        var itemIds = ordered.Where(o => o.Value > 0 && tracked.ContainsKey(o.Key)).Select(o => o.Key).ToList();
        var location = await _stock.StockLocationAsync(companyId, warehouseId);
        var onVan = await _db.StockBalances.AsNoTracking().Where(b => b.LocationId == location.Id && itemIds.Contains(b.ItemId))
            .ToDictionaryAsync(b => b.ItemId, b => b.Quantity);
        return Ok(itemIds.Select(id => tracked[id]).OrderBy(i => i.Code).Select(i =>
        {
            var have = onVan.GetValueOrDefault(i.Id);
            return new VanLoadLineResponse(i.Id, i.Code, i.Name, i.Unit, ordered[i.Id], have, Math.Max(0m, ordered[i.Id] - have));
        }).ToList());
    }

    // The evening settlement: per item what the van started with, took on, sold, got back and
    // unloaded, and the money the day brought (invoices from the van, POS coupons of stores selling
    // from it, cash collected on visits by its driver).
    [HttpGet("vans/{warehouseId:guid}/settlement", Name = "GetVanSettlement")]
    [RequireCompanyAccess(module: AccessModule.Inventory)]
    public async Task<ActionResult<VanSettlementResponse>> Settlement(Guid companyId, Guid warehouseId, [FromQuery] DateOnly? date = null)
    {
        var van = await VanAsync(companyId, warehouseId);
        if (van is null) return NotFound();
        var day = date ?? Today;
        var location = await _stock.StockLocationAsync(companyId, warehouseId);
        var customer = await _stock.VirtualLocationAsync(companyId, LocationUsage.Customer);
        var moves = await _db.StockMoves.AsNoTracking()
            .Where(m => m.CompanyId == companyId && m.Date == day && (m.FromLocationId == location.Id || m.ToLocationId == location.Id))
            .ToListAsync();
        var itemIds = moves.Select(m => m.ItemId).Distinct().ToList();
        // Items still on the van that didn't move today belong on the sheet too.
        itemIds.AddRange(await _db.StockBalances.AsNoTracking().Where(b => b.LocationId == location.Id && b.Quantity != 0 && !itemIds.Contains(b.ItemId))
            .Select(b => b.ItemId).ToListAsync());
        var opening = await _stock.QuantitiesAtAsync(location.Id, itemIds, day.AddDays(-1));
        var items = await _db.Items.AsNoTracking().Where(i => itemIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);

        var lines = itemIds.Where(items.ContainsKey).Select(id => items[id]).OrderBy(i => i.Code).Select(i =>
        {
            var own = moves.Where(m => m.ItemId == i.Id).ToList();
            decimal Sum(Func<StockMove, bool> f) => own.Where(f).Sum(m => m.Quantity);
            var loaded = Sum(m => m.Kind == StockMoveKind.Transfer && m.ToLocationId == location.Id);
            var unloaded = Sum(m => m.Kind == StockMoveKind.Transfer && m.FromLocationId == location.Id);
            var sold = Sum(m => m.Kind == StockMoveKind.Issue && m.ToLocationId == customer.Id);
            var returned = Sum(m => m.Kind == StockMoveKind.Receipt && m.FromLocationId == customer.Id);
            var otherIn = Sum(m => m.Kind == StockMoveKind.Receipt && m.FromLocationId != customer.Id);
            var otherOut = Sum(m => m.Kind == StockMoveKind.Issue && m.ToLocationId != customer.Id);
            var start = opening.GetValueOrDefault(i.Id);
            var other = otherIn - otherOut;
            return new VanSettlementLineResponse(i.Id, i.Code, i.Name, i.Unit, start, loaded, sold, returned, unloaded, other,
                start + loaded - unloaded - sold + returned + other);
        }).ToList();

        var invoices = await _db.Invoices.AsNoTracking()
            .Where(i => i.CompanyId == companyId && i.WarehouseId == warehouseId && i.IssueDate == day && i.State == InvoiceState.Posted
                && i.DocumentType == DocumentType.Invoice && i.JournalEntryId != null)
            .Select(i => new { i.Id, i.PartnerId, i.JournalEntryId })
            .ToListAsync();
        var invoiced = 0m;
        foreach (var invoice in invoices)
        {
            var receivable = await _db.Partners.AsNoTracking().Where(p => p.Id == invoice.PartnerId).Select(p => p.ReceivableAccountId).FirstOrDefaultAsync()
                ?? await _db.CompanyAccountDefaults.AsNoTracking().Where(d => d.CompanyId == companyId).Select(d => (Guid?)d.ReceivableAccountId).FirstOrDefaultAsync();
            invoiced += await _db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntryId == invoice.JournalEntryId && l.AccountId == receivable).SumAsync(l => l.Debit);
        }

        var coupons = await _db.PosOrders.AsNoTracking()
            .Where(o => o.CompanyId == companyId && _db.PosStores.Any(s => s.Id == o.StoreId && s.WarehouseId == warehouseId)
                && _db.PosSessions.Any(s => s.Id == o.SessionId && s.BusinessDate == day))
            .Select(o => new { o.Kind, o.Total })
            .ToListAsync();
        var couponSales = coupons.Sum(o => o.Kind == Pako.Domain.Pos.PosOrderKind.Sale ? o.Total : -o.Total);

        var visits = van.DriverUserId is { } driver
            ? await _db.RouteVisits.AsNoTracking().Where(v => v.CompanyId == companyId && v.Date == day && v.UserId == driver).ToListAsync()
            : new List<RouteVisit>();

        return Ok(new VanSettlementResponse(van.Id, van.Name, day, lines, invoices.Count, invoiced, coupons.Count(o => o.Kind == Pako.Domain.Pos.PosOrderKind.Sale),
            couponSales, visits.Sum(v => v.Collected), visits.Count));
    }
}
