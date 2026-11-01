namespace Pako.Domain.Inventory;

// docs/POS_PLAN.md §6.10 / P6 — van sales and pre-selling. A van is a warehouse (Warehouse.IsVan)
// driven by one member: loaded in the morning and unloaded in the evening with ordinary transfers,
// selling from its own stock. A route is the list of customers a salesperson visits on given days;
// each visit is checked in on the spot (GPS) and records what came of it.
public class SalesRoute
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    // The salesperson or driver who works it.
    public Guid? UserId { get; set; }
    // The van it is driven with (null = pre-selling, goods delivered later from a warehouse).
    public Guid? WarehouseId { get; set; }
    // Days it runs, Monday = bit 0.
    public int Days { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<SalesRouteStop> Stops { get; set; } = new();
}

public class SalesRouteStop
{
    public Guid Id { get; set; }
    public Guid RouteId { get; set; }
    public Guid PartnerId { get; set; }
    public int Sequence { get; set; }
    public string? Notes { get; set; }
}

public enum RouteVisitOutcome
{
    // Checked in; nothing recorded yet.
    Open,
    Order,
    Sale,
    Collection,
    NoOrder,
    Closed,
}

public class RouteVisit
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? RouteId { get; set; }
    public Guid PartnerId { get; set; }
    public Guid UserId { get; set; }
    // The local (Kosovo) day of the visit.
    public DateOnly Date { get; set; }
    public DateTime CheckInAt { get; set; } = DateTime.UtcNow;
    public DateTime? CheckOutAt { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public double? AccuracyMeters { get; set; }
    public RouteVisitOutcome Outcome { get; set; }
    // Cash or cheque collected on the spot (the payment itself is recorded on the invoices).
    public decimal Collected { get; set; }
    public string? Notes { get; set; }
}
