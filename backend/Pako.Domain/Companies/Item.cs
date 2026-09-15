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

    public List<ItemBarcode> Barcodes { get; set; } = new();
}
