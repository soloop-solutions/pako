namespace Pako.Domain.Inventory;

// docs/INVENTORY_PLAN.md §12 P6 — how much of a receipt line a posted bill line billed. Written when
// the bill posts; never edited. The receipt line's billed quantity is the sum of its matches, and
// what is left open is what 120800 still carries.
public class ReceiptMatch
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid BillId { get; set; }
    public Guid BillLineId { get; set; }
    // A StockDocumentLine of a posted Receipt.
    public Guid ReceiptLineId { get; set; }
    public decimal Quantity { get; set; }
    // Quantity × the receipt's unit cost: what this match takes off 120800.
    public decimal Value { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
