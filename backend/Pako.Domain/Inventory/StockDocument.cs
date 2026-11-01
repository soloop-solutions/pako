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
    WriteOff,
    // Phase 2 (IAS 2 §28–33, IFRS for SMEs §13.19): stock worth less than it cost. Each line gives an
    // item's net realisable value per unit; the allowance on 120900 is brought to
    // quantity × (average cost − NRV). Moves no stock and leaves the average cost alone.
    WriteDown,
    // §12 P6: goods from a vendor counted in before the bill arrives (fletëpranim). Stock comes in at
    // the entered net cost against 120800 (goods received, not invoiced); the vendor's bill later
    // clears 120800 for the matched quantity (ReceiptMatch) instead of adding the stock again.
    Receipt,
    // docs/POS_PLAN.md P6: goods sent to a customer (fletëdërgesë) before the invoice. Stock leaves at
    // average cost with cost of goods sold booked on delivery (IFRS 15: control passes with the
    // goods); invoice lines that name the delivery line then post revenue only.
    Delivery,
    // docs/ERP_VERTICALS_PLAN.md §1: materials sent from the warehouse to a construction site, charged
    // to the site's project at average cost (Dr cost of sales tagged with the project / Cr stock).
    SiteIssue
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
    // Receipts: the vendor the goods came from. Deliveries: the customer they went to.
    public Guid? PartnerId { get; set; }
    // Site issues: the construction site.
    public Guid? SiteId { get; set; }
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
    // Opening: the cost per unit. Write-down: the net realisable value per unit.
    public decimal? UnitCost { get; set; }
    // Count only, set when posted: the book quantity at the count date and the difference.
    // Write-down: BookQuantity is the company-wide quantity at the date.
    public decimal? BookQuantity { get; set; }
    public decimal? Difference { get; set; }
    // Write-down, set when posted: the average cost at the date, the allowance the item should carry
    // and the change posted to bring it there (negative = a reversal).
    public decimal? AverageCost { get; set; }
    public decimal? AllowanceAfter { get; set; }
    public decimal? Amount { get; set; }
    // Receipts: the purchase order line the goods were ordered on, if any.
    public Guid? PurchaseOrderLineId { get; set; }
    // Deliveries: the sales order line the goods were ordered on, if any.
    public Guid? SalesOrderLineId { get; set; }
    // Site issues: the cost code charged.
    public Guid? CostCodeId { get; set; }
    // §12 P8, items that track lots: the lot received (opening, receipt, count overage) or taken
    // from (write-off, transfer, count shortage; the earliest expiry first when empty).
    public string? LotNumber { get; set; }
    public DateOnly? ExpiryDate { get; set; }
    public string? Note { get; set; }
    public StockDocument? StockDocument { get; set; }
}
