namespace Pako.Domain.Inventory;

// docs/POS_PLAN.md P2 (electronics, phones): one row per serial number or IMEI of an item that
// tracks serials — when it was sold, on which order, and until when its warranty runs.
public enum ItemSerialStatus
{
    InStock,
    Sold,
    Returned,
}

public class ItemSerial
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid ItemId { get; set; }
    public string Serial { get; set; } = string.Empty;
    public ItemSerialStatus Status { get; set; }
    public Guid? SoldOrderId { get; set; }
    public DateTime? SoldAt { get; set; }
    public DateOnly? WarrantyUntil { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
