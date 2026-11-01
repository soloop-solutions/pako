namespace Pako.Domain.Inventory;

public enum StockMoveKind
{
    // Into stock from a virtual location (supplier, customer return, opening, count surplus).
    Receipt,
    // Out of stock to a virtual location (customer, supplier return, count shortage, scrap).
    Issue,
    // Between two stock locations: no change to company quantity or value.
    Transfer,
    // Value only, no quantity (a supplier credit note for goods in stock, a cost correction).
    Revaluation
}

public enum StockMoveSource
{
    Bill,
    Invoice,
    StockDocument,
    // docs/POS_PLAN.md D6: a till order (sale, return or cancellation).
    Pos
}

// docs/INVENTORY_PLAN.md D10: the stock ledger. One row per change, never edited once written —
// a correction is a new move. Besides the change itself, each move stores the item's company-wide
// totals right after it (ERPNext's Stock Ledger Entry pattern), so "stock at a date" is the last
// move on or before that date, and a back-dated document can replay forward from the move before it.
public class StockMove
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    // Tie-breaker for moves on the same date: database-generated, always increasing.
    public long Sequence { get; set; }
    public DateOnly Date { get; set; }
    public Guid ItemId { get; set; }
    public StockMoveKind Kind { get; set; }
    public Guid FromLocationId { get; set; }
    public Guid ToLocationId { get; set; }
    // In the item's unit; 0 for a revaluation.
    public decimal Quantity { get; set; }
    public decimal UnitCost { get; set; }
    // Magnitude of value moved (2 decimals). Receipts and issues change stock value by ±Value;
    // a revaluation by ValueDelta; a transfer not at all.
    public decimal Value { get; set; }
    // Signed change to the item's stock value: +receipt, −issue, ±revaluation, 0 transfer.
    public decimal ValueDelta { get; set; }
    // The part of this move's value that went to cost of goods sold instead of stock (see
    // AverageCost.CostResult): the negative-stock true-up, a credit for goods already sold. A
    // back-dated replay posts only the difference from what was booked here.
    public decimal Correction { get; set; }
    public decimal QtyAfter { get; set; }
    public decimal AvgCostAfter { get; set; }
    public decimal ValueAfter { get; set; }
    public StockMoveSource SourceType { get; set; }
    public Guid SourceId { get; set; }
    public Guid? SourceLineId { get; set; }
    public string? Reference { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// docs/INVENTORY_PLAN.md §5.1: quantity per item and location (Odoo's quant), kept in the same
// transaction as the moves and rebuildable from them.
public class StockBalance
{
    public Guid CompanyId { get; set; }
    public Guid ItemId { get; set; }
    public Guid LocationId { get; set; }
    public decimal Quantity { get; set; }
}

// The item's company-wide position after its latest move (average cost is per company, D12).
public class ItemCost
{
    public Guid CompanyId { get; set; }
    public Guid ItemId { get; set; }
    public decimal Quantity { get; set; }
    public decimal AverageCost { get; set; }
    public decimal Value { get; set; }
    public DateOnly? LastMoveDate { get; set; }
}
