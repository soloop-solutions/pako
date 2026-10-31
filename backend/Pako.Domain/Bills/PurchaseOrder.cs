namespace Pako.Domain.Bills;

// docs/INVENTORY_PLAN.md §12 P5 — what was ordered from a vendor, so the bill can be checked against
// it. A purchase order never posts: it is a commitment, not a transaction. Bill lines keep the link
// (BillLine.PurchaseOrderLineId) and the billed quantity is read from posted bills, so the order
// always agrees with the ledger. The match is soft: billing more or less than ordered warns, never
// blocks.
public enum PurchaseOrderState
{
    Draft,
    // Sent to the vendor; bills can be made from it.
    Confirmed,
    // Nothing more is expected (fully billed, or the rest closed by hand).
    Closed,
    Cancelled
}

public class PurchaseOrder
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid PartnerId { get; set; }
    // Given when confirmed.
    public string? Number { get; set; }
    public DateOnly Date { get; set; }
    public DateOnly? ExpectedDate { get; set; }
    // Where the goods should arrive; null = the default warehouse.
    public Guid? WarehouseId { get; set; }
    public PurchaseOrderState State { get; set; } = PurchaseOrderState.Draft;
    public string? VendorReference { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? CreatedByUserId { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public List<PurchaseOrderLine> Lines { get; set; } = new();
}

public class PurchaseOrderLine
{
    public Guid Id { get; set; }
    public Guid PurchaseOrderId { get; set; }
    public Guid? ItemId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    // The expected price, VAT-inclusive like bill lines (the bill carries the real one).
    public decimal UnitPrice { get; set; }
    public Guid? TaxDefinitionId { get; set; }
    public int SortOrder { get; set; }
    public PurchaseOrder? PurchaseOrder { get; set; }
}
