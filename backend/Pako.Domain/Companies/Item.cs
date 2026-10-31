namespace Pako.Domain.Companies;

// B6: Goods carries stock conceptually (Normative is Kosovo/Albanian accounting terminology for
// a recipe/BOM-costed goods line — a restaurant dish, say), Service does not. No quantities or
// valuation exist yet for any of the three (explicitly out of scope for this release) — the type
// exists now so a later stock feature has something to filter on without a data migration.
public enum ItemType
{
    Goods,
    Service,
    Normative
}

// S0.3 (Sprint 0 registers, additive/inert): the item register's schema. Code is a plain data
// column here — the per-company ordinal series machinery (1...35000+) is Track B1/B6's job to
// wire up, not Sprint 0's. No quantities/valuation (explicitly out of scope for this release).
public class Item
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public int Code { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Unit { get; set; } = string.Empty;
    public ItemType Type { get; set; } = ItemType.Goods;
    public Guid? DefaultTaxDefinitionId { get; set; }
    public Guid? DefaultRevenueAccountId { get; set; }
    public Guid? DefaultExpenseAccountId { get; set; }
    // B6: the third of the three default accounts the task asks for — inert today (no stock
    // quantities or valuation to post against it), same "field exists, feature doesn't yet"
    // posture as ItemType itself.
    public Guid? DefaultInventoryAccountId { get; set; }
    public decimal? DefaultUnitPrice { get; set; }

    // docs/INVENTORY_PLAN.md: the category supplies the accounts when the item doesn't (D9); a
    // tracked Goods item carries stock — bills and invoices move it and cost of goods sold is posted.
    // Untracked items keep posting exactly as before (D5).
    public Guid? CategoryId { get; set; }
    public bool TrackInventory { get; set; }
    // Below this, the item shows on the low-stock report.
    public decimal? MinimumStock { get; set; }

    public List<ItemBarcode> Barcodes { get; set; } = new();

    // docs/INVENTORY_PLAN.md §12 P7: Unit is the base (stock) unit. A purchase and a sales unit can
    // be named multiples of it (box = 24 pieces); documents may be entered in either, and stock
    // always moves in base units.
    // §12 P8: quantities are kept per lot with an expiry date (stock-tracked goods only; fixed once
    // stock has moved, like TrackInventory).
    public bool TrackLots { get; set; }

    public string? PurchaseUnit { get; set; }
    public decimal? PurchaseUnitFactor { get; set; }
    public string? SalesUnit { get; set; }
    public decimal? SalesUnitFactor { get; set; }
}
