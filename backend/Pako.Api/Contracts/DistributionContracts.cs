using Pako.Domain.Inventory;

namespace Pako.Api.Contracts;

// docs/POS_PLAN.md P6 — routes, visits and van settlement. Days: Monday = bit 0 … Sunday = bit 6.
public record SalesRouteStopRequest(Guid PartnerId, string? Notes = null);
public record SaveSalesRouteRequest(string Name, Guid? UserId, Guid? WarehouseId, int Days, List<SalesRouteStopRequest> Stops, bool IsActive = true);
public record SalesRouteStopResponse(Guid Id, Guid PartnerId, string PartnerName, int Sequence, string? Notes);
public record SalesRouteResponse(Guid Id, string Name, Guid? UserId, Guid? WarehouseId, string? WarehouseName, int Days, bool IsActive,
    List<SalesRouteStopResponse> Stops);

// The member's route for a day: each stop with today's visit (if any) and what the customer owes.
public record RouteDayStopResponse(Guid PartnerId, string PartnerName, int Sequence, string? Notes, Guid? VisitId, RouteVisitOutcome? Outcome,
    decimal Outstanding, decimal Overdue, bool Blocked, decimal Collected = 0m, string? VisitNotes = null, DateTime? CheckOutAt = null);
public record RouteDayResponse(Guid RouteId, string Name, Guid? WarehouseId, DateOnly Date, List<RouteDayStopResponse> Stops);

public record CheckInRequest(Guid PartnerId, Guid? RouteId = null, double? Latitude = null, double? Longitude = null, double? AccuracyMeters = null);
public record UpdateVisitRequest(RouteVisitOutcome Outcome, decimal Collected = 0m, string? Notes = null, bool CheckOut = true);
public record RouteVisitResponse(Guid Id, Guid? RouteId, Guid PartnerId, string PartnerName, Guid UserId, DateOnly Date, DateTime CheckInAt,
    DateTime? CheckOutAt, double? Latitude, double? Longitude, double? AccuracyMeters, RouteVisitOutcome Outcome, decimal Collected, string? Notes,
    List<Guid> SalesOrderIds, List<string?>? SalesOrderNumbers = null);

// Strike rate: visits that ended in an order or sale over all visits. Drop size: order value per such visit.
public record VisitSummaryResponse(int Visits, int WithOrder, decimal StrikeRate, decimal OrderValue, decimal DropSize, decimal Collected,
    List<RouteVisitResponse> Items);

// One item's movement through a van on a day (base units).
public record VanSettlementLineResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, decimal Opening, decimal Loaded, decimal Sold,
    decimal Returned, decimal Unloaded, decimal Other, decimal Closing);
public record VanSettlementResponse(Guid WarehouseId, string WarehouseName, DateOnly Date, List<VanSettlementLineResponse> Lines,
    int Invoices, decimal Invoiced, int Coupons, decimal CouponSales, decimal Collected, int Visits);

// What to load: confirmed orders still to deliver for the customers on the van's routes that day.
public record VanLoadLineResponse(Guid ItemId, int ItemCode, string ItemName, string Unit, decimal Ordered, decimal OnVan, decimal ToLoad);
