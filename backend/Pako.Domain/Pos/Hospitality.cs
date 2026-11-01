namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §6.2, §12.7, P3: restaurants, cafés and bars. Tables are grouped on floors; a
// tab (open ticket) collects what a table orders until it pays. Paying turns all or part of a tab
// into an ordinary till order with its fiscal coupon — nothing on a tab is fiscal before that.
public class Floor
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public List<DiningTable> Tables { get; set; } = new();
}

public enum TableShape
{
    Square,
    Round,
    Rectangle,
}

public class DiningTable
{
    public Guid Id { get; set; }
    public Guid FloorId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int Seats { get; set; } = 4;
    public TableShape Shape { get; set; }
    // Position and size on the floor plan, in grid units.
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; } = 2;
    public int Height { get; set; } = 2;
    // The QR menu's secret for this table: only someone holding the printed code can order from it.
    public string QrToken { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
}

public enum TabKind
{
    DineIn,
    Takeaway,
    Delivery,
    // P5: a hotel guest's folio (room nights, tourist tax, outlet charges) and an event's bill.
    Folio,
    Event,
}

public enum TabState
{
    Open,
    // A pre-bill (non-fiscal) was printed; still open for payment or more orders.
    PreBilled,
    Closed,
    Cancelled,
}

public class Tab
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public Guid? TableId { get; set; }
    public string Number { get; set; } = string.Empty;
    public string? Name { get; set; }
    public TabKind Kind { get; set; }
    public TabState State { get; set; }
    public int Covers { get; set; }
    public Guid WaiterUserId { get; set; }
    public string WaiterName { get; set; } = string.Empty;
    // Delivery: where, who to call, and the driver.
    public string? DeliveryAddress { get; set; }
    public string? DeliveryPhone { get; set; }
    public string? DriverName { get; set; }
    public int PreBillCount { get; set; }
    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClosedAt { get; set; }
    public List<TabLine> Lines { get; set; } = new();
}

public enum TabLineState
{
    // Ordered, not yet sent to the kitchen or bar.
    Pending,
    Sent,
    Voided,
    // Asked for from the QR menu; a waiter accepts it before it counts.
    Requested,
}

public class TabLine
{
    public Guid Id { get; set; }
    public Guid TabId { get; set; }
    public int LineNo { get; set; }
    public Guid ItemId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    // VAT-inclusive, including the modifiers' price changes.
    public decimal UnitPrice { get; set; }
    public decimal DiscountAmount { get; set; }
    public TabLineState State { get; set; }
    public int? Seat { get; set; }
    public int Course { get; set; } = 1;
    public string? Note { get; set; }
    // The modifiers chosen ("pa qepë", "extra djathë"), as printed on the kitchen ticket.
    public string? Modifiers { get; set; }
    // Their ids (comma-separated): recipe changes travel with the line to the sale.
    public string? ModifierIds { get; set; }
    // A combo's choice lines point at the combo line.
    public Guid? ParentLineId { get; set; }
    public Guid? ProductionCenterId { get; set; }
    public DateTime? SentAt { get; set; }
    public string? VoidReason { get; set; }
    public Guid? VoidedByUserId { get; set; }
    // How much of the line has been paid (split bills pay parts of lines).
    public decimal PaidQuantity { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
