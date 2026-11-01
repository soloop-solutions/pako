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

    // S0.3 (Sprint 0 registers, additive/inert): nullable so free-text lines keep working.
    public Guid? ItemId { get; set; }

    // §12 P7: the unit the quantity was entered in (null = the item's base unit) and how many base
    // units one of it holds. Stock moves Quantity × UnitFactor.
    public string? UnitName { get; set; }
    public decimal UnitFactor { get; set; } = 1m;

    // §12 P8, items that track lots: the lot received (bills: required, with its expiry) or the lot
    // to sell from (invoices: optional; the earliest expiry first otherwise).
    public string? LotNumber { get; set; }
    public DateOnly? ExpiryDate { get; set; }

    // docs/POS_PLAN.md P6: the sales order line invoiced, and the posted delivery line whose goods
    // this bills. A line naming a delivery moves no stock (the delivery already did).
    public Guid? SalesOrderLineId { get; set; }
    public Guid? DeliveryLineId { get; set; }

    public Invoice? Invoice { get; set; }
}
