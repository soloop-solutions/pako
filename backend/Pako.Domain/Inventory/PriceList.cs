namespace Pako.Domain.Inventory;

// docs/INVENTORY_PLAN.md §12 P4 — sales prices kept apart from the item: one company-wide list
// (WarehouseId null) and, for shops that price differently, one list per warehouse. Prices are
// VAT-inclusive (what the shelf shows) and dated, so a price is always "the latest one valid on
// the day". A price list never touches the ledger: stock is carried at cost.
public class PriceList
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    // Null = the company-wide list; otherwise the shop (warehouse) it prices.
    public Guid? WarehouseId { get; set; }
    // docs/POS_PLAN.md P6: a list for named customers (Partner.PriceListId), not a shop or the
    // company list; it has no warehouse.
    public bool IsCustomerList { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// One price of one item from a date. Written by a posted price change (Nivelim), never edited.
public class PriceListPrice
{
    public Guid Id { get; set; }
    public Guid PriceListId { get; set; }
    public Guid ItemId { get; set; }
    public decimal Price { get; set; }
    // docs/POS_PLAN.md P6: a volume tier — this price applies from this quantity (base units) up;
    // 0 is the ordinary price.
    public decimal MinQuantity { get; set; }
    public DateOnly ValidFrom { get; set; }
    public Guid PriceChangeId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum PriceChangeState
{
    Draft,
    Posted
}

// The price-change document ("Nivelim"): a dated list of old and new prices for one price list,
// with the quantity on hand in that list's warehouse, kept as the shelf record (Consumer Protection
// Law Art. 26 expects posted prices to be traceable). Posting makes the new prices current from its
// date; it writes no journal entry.
public class PriceChange
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid PriceListId { get; set; }
    public PriceChangeState State { get; set; } = PriceChangeState.Draft;
    public string? Number { get; set; }
    public DateOnly Date { get; set; }
    public string? Notes { get; set; }
    public Guid? PostedByUserId { get; set; }
    public DateTime? PostedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<PriceChangeLine> Lines { get; set; } = new();

    public bool IsPosted => State == PriceChangeState.Posted;
}

public class PriceChangeLine
{
    public Guid Id { get; set; }
    public Guid PriceChangeId { get; set; }
    public Guid ItemId { get; set; }
    // The volume tier the price is for (0 = the ordinary price).
    public decimal MinQuantity { get; set; }
    public decimal NewPrice { get; set; }
    // Set when posted: the price in force the day before, the quantity on hand in the list's
    // warehouse (company-wide for the company list) and quantity × (new − old), the shelf
    // revaluation the record shows. Informational only.
    public decimal? OldPrice { get; set; }
    public decimal? Quantity { get; set; }
    public decimal? Difference { get; set; }
    public PriceChange? PriceChange { get; set; }
}
