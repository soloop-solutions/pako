namespace Pako.Domain.Inventory;

// docs/INVENTORY_PLAN.md D1: weighted average only in phase 1. Kept as an enum so FIFO (phase 2)
// is an addition, not a migration.
public enum CostMethod
{
    Average
}

// D2: Block refuses any document that would take a warehouse below zero (now or at any later date
// when back-dated); Warn allows it and corrects the cost when stock arrives.
public enum NegativeStockPolicy
{
    Block,
    Warn
}

public class StockSettings
{
    public Guid CompanyId { get; set; }
    public CostMethod CostMethod { get; set; } = CostMethod.Average;
    // D1: the cost method is kept from this date (the CIT rules keep a method for the year chosen
    // plus three tax periods); it can't change once stock has moved.
    public DateOnly? CostMethodSince { get; set; }
    public NegativeStockPolicy NegativeStock { get; set; } = NegativeStockPolicy.Block;
    public Guid? DefaultWarehouseId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
