namespace Pako.Domain.Inventory;

// docs/INVENTORY_PLAN.md D9: a product category carries the accounts its items post to, the way
// Odoo's product.category, ERPNext's Item Group and Business Central's posting groups do. An item
// account set on the item itself overrides the category; the company default comes last.
public class ItemCategory
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    // Stock valuation (Goods for Sale 120100 by default).
    public Guid? InventoryAccountId { get; set; }
    // Cost of goods sold for stock-tracked items (500100 by default).
    public Guid? CogsAccountId { get; set; }
    public Guid? RevenueAccountId { get; set; }
    // Expense for items that are not stock-tracked (services, consumables).
    public Guid? ExpenseAccountId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
