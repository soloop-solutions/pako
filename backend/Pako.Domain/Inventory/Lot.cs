namespace Pako.Domain.Inventory;

// docs/INVENTORY_PLAN.md §12 P8 — lots (batches) with an expiry date, for items that track them
// (food, pharmacy, chemicals). A lot is a quantity layer beside the cost engine: average cost stays
// per item, while each stock move records which lots it took from or added to (StockMoveLot), and
// LotBalance keeps the quantity of each lot in each location. Issues take the earliest expiry
// first (FEFO) unless the document names a lot.
public class Lot
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid ItemId { get; set; }
    public string Number { get; set; } = string.Empty;
    public DateOnly? ExpiryDate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class LotBalance
{
    public Guid LotId { get; set; }
    public Guid LocationId { get; set; }
    public Guid CompanyId { get; set; }
    public Guid ItemId { get; set; }
    public decimal Quantity { get; set; }
}

// How much of one stock move belongs to one lot.
public class StockMoveLot
{
    public Guid Id { get; set; }
    public Guid StockMoveId { get; set; }
    public Guid LotId { get; set; }
    public decimal Quantity { get; set; }
}
