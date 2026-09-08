namespace Pako.Domain.Bills;

public class BillLine
{
    public Guid Id { get; set; }
    public Guid BillId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal DiscountPercent { get; set; }
    public Guid? TaxDefinitionId { get; set; }
    public Guid ExpenseAccountId { get; set; }

    // S0.3 (Sprint 0 registers, additive/inert): nullable so free-text lines keep working.
    public Guid? ItemId { get; set; }

    public Bill? Bill { get; set; }
}
