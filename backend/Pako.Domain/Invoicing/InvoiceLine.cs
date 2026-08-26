namespace Pako.Domain.Invoicing;

public class InvoiceLine
{
    public Guid Id { get; set; }
    public Guid InvoiceId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal DiscountPercent { get; set; }
    public Guid? TaxDefinitionId { get; set; }
    public Guid RevenueAccountId { get; set; }

    public Invoice? Invoice { get; set; }
}
