namespace Pako.Domain.Inventory;

// docs/INVENTORY_PLAN.md §5.1: a warehouse (magazina) is a place stock is kept. Each has one
// internal "Stock" location; every company also has one virtual location per counterpart
// (supplier, customer, opening, adjustment, scrap) so that every quantity change is a move from
// one location to another — double entry for quantities, the way Odoo models it.
public class Warehouse
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Address { get; set; }
    public bool IsActive { get; set; } = true;
    // docs/POS_PLAN.md P6: a delivery van selling from its own stock, and the member who drives it.
    public bool IsVan { get; set; }
    public Guid? DriverUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum LocationUsage
{
    // Real stock, in a warehouse: counts towards quantity on hand.
    Internal,
    // On the road between warehouses (phase 2).
    Transit,
    // Virtual counterparts — never "on hand".
    Supplier,
    Customer,
    Opening,
    Adjustment,
    Scrap
}

public class StockLocation
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    // Set for Internal and Transit locations; null for the virtual ones.
    public Guid? WarehouseId { get; set; }
    public string Name { get; set; } = string.Empty;
    public LocationUsage Usage { get; set; }

    public bool IsStock => Usage is LocationUsage.Internal or LocationUsage.Transit;
}
