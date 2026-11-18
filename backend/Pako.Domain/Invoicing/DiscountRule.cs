namespace Pako.Domain.Invoicing;

// Client feedback 2026-11: a percentage discount (rabat) for a period, for a customer, an item
// category, a single item, or a combination. Invoices and sales orders dated inside the period get
// the percentage as the line's starting discount. At least one target must be set.
[Pako.Domain.Shared.Audited]
public class DiscountRule
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid? PartnerId { get; set; }
    public Guid? ItemCategoryId { get; set; }
    public Guid? ItemId { get; set; }
    public decimal Percent { get; set; }
    public DateOnly ValidFrom { get; set; }
    public DateOnly ValidTo { get; set; }
    // Breaks a tie between equally specific rules: higher first.
    public int Priority { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
