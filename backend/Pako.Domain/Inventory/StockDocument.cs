namespace Pako.Domain.Inventory;

// docs/INVENTORY_PLAN.md §5.1: one aggregate for every stock-only document, instead of one per
// type (the "three document models" lesson from docs/ODOO_COMPARISON.md).
public enum StockDocumentType
{
    // Starting quantities and costs; credits the opening balance clearing account (D3).
    Opening,
    // Between warehouses; no ledger entry.
    Transfer,
    // A physical count (inventarizimi): counted vs book quantity becomes shortage/overage moves.
    Count,
    // Goods taken out of use: expired, damaged, stolen, destroyed (D14).
    WriteOff
}

public enum StockDocumentState
{
    Draft,
    Posted
}

// D14 (AI 03/2015 Arts. 61–62): why goods left stock decides the VAT and tax treatment.
public enum WriteOffReason
{
    Expired,
    Damaged,
    // Theft: input VAT must be paid back (Art. 62).
    Theft,
    // Fire, flood, accident documented by a public authority (Art. 61.3).
    Disaster,
    // Unexplained shortage: treated as a sale for VAT (Art. 61.1.4).
    Unexplained,
    Other
}

public class StockDocument
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public StockDocumentType Type { get; set; }
    public StockDocumentState State { get; set; } = StockDocumentState.Draft;
    public string? Number { get; set; }
    public DateOnly Date { get; set; }
    // The warehouse the document concerns; for a transfer, the source.
    public Guid WarehouseId { get; set; }
    // Transfers only.
    public Guid? DestinationWarehouseId { get; set; }
    public WriteOffReason? Reason { get; set; }
    // D14: destruction of expired or damaged goods needs written notice to ATK 10 days before.
    public DateOnly? AtkNoticeDate { get; set; }
    public string? Notes { get; set; }
    public Guid? JournalEntryId { get; set; }
    public Guid? PostedByUserId { get; set; }
    public DateTime? PostedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<StockDocumentLine> Lines { get; set; } = new();

    public bool IsPosted => State == StockDocumentState.Posted;
}

public class StockDocumentLine
{
    public Guid Id { get; set; }
    public Guid StockDocumentId { get; set; }
    public Guid ItemId { get; set; }
    // Opening, transfer, write-off: the quantity. Count: the counted quantity.
    public decimal Quantity { get; set; }
    // Opening only: the cost per unit.
    public decimal? UnitCost { get; set; }
    // Count only, set when posted: the book quantity at the count date and the difference.
    public decimal? BookQuantity { get; set; }
    public decimal? Difference { get; set; }
    public string? Note { get; set; }
    public StockDocument? StockDocument { get; set; }
}
