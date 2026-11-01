namespace Pako.Domain.Invoicing;

// docs/POS_PLAN.md P6 — the B2B selling chain: quote (ofertë) → order (porosi) → delivery notes
// (fletëdërgesë, a Delivery stock document that takes the goods out) → invoices. Like a purchase
// order, a sales order never posts: delivered and invoiced quantities are always read back from the
// posted deliveries and invoices that link its lines.
public enum SalesOrderState
{
    Draft,
    // Numbered as a quote and sent to the customer; can still be edited back to draft.
    Quoted,
    // Accepted: numbered as an order; deliveries and invoices can be made from it.
    Confirmed,
    // Nothing more will be delivered (fully done, or the rest dropped by hand).
    Closed,
    Cancelled,
}

public class SalesOrder
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid PartnerId { get; set; }
    public SalesOrderState State { get; set; } = SalesOrderState.Draft;
    public string? QuoteNumber { get; set; }
    public string? Number { get; set; }
    public DateOnly Date { get; set; }
    public DateOnly? ValidUntil { get; set; }
    public DateOnly? DeliveryDate { get; set; }
    // Where the goods leave from; null = the default warehouse.
    public Guid? WarehouseId { get; set; }
    public string? CustomerReference { get; set; }
    public string? DeliveryAddress { get; set; }
    public string? Notes { get; set; }
    // A van-sales visit the order was taken on.
    public Guid? RouteVisitId { get; set; }
    // Credit limit or overdue block overridden on confirmation (Sales: Approve), and why.
    public Guid? BlockOverriddenByUserId { get; set; }
    public string? BlockOverrideReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? CreatedByUserId { get; set; }
    public DateTime? QuotedAt { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public List<SalesOrderLine> Lines { get; set; } = new();
}

public class SalesOrderLine
{
    public Guid Id { get; set; }
    public Guid SalesOrderId { get; set; }
    public Guid? ItemId { get; set; }
    public string Description { get; set; } = string.Empty;
    // In UnitName (null = the item's base unit); UnitFactor base units per unit.
    public decimal Quantity { get; set; }
    public string? UnitName { get; set; }
    public decimal UnitFactor { get; set; } = 1m;
    // VAT-inclusive, per UnitName.
    public decimal UnitPrice { get; set; }
    public decimal DiscountPercent { get; set; }
    public Guid? TaxDefinitionId { get; set; }
    public int SortOrder { get; set; }
    public SalesOrder? SalesOrder { get; set; }

    // The ordered quantity in base units.
    public decimal BaseQuantity => Quantity * UnitFactor;

    // VAT-inclusive line amount after the discount, to the cent.
    public decimal Gross => Math.Round(Quantity * UnitPrice * (1 - DiscountPercent / 100m), 2, MidpointRounding.AwayFromZero);

    // The part of the line amount still open when `done` base units are behind it (delivered or
    // invoiced), to the cent.
    public decimal OpenGross(decimal done) =>
        BaseQuantity <= 0 ? 0m : Math.Round(Gross * Math.Max(0m, BaseQuantity - done) / BaseQuantity, 2, MidpointRounding.AwayFromZero);
}
