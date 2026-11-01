namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §6.2 / P3: what a restaurant's menu adds to the item register — where each dish
// is made (production centre: kitchen, bar, pizza oven), the choices it takes (modifiers: "pa
// qepë", "extra djathë", required sizes) and combos (a menu with a choice of main and drink).
public enum ProductionCenterKind
{
    Kitchen,
    Bar,
    Grill,
    Pizza,
    Dessert,
    Other,
}

public class ProductionCenter
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    // Null: every store's kitchen of this name.
    public Guid? StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public ProductionCenterKind Kind { get; set; }
    // The printer its tickets go to (a PAKO Station printer name); empty = screen (KDS) only.
    public string? PrinterName { get; set; }
    public bool IsActive { get; set; } = true;
}

public class ModifierGroup
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    // How many of its modifiers a line must and may take (MaxSelect 0 = no limit).
    public int MinSelect { get; set; }
    public int MaxSelect { get; set; }
    public bool IsActive { get; set; } = true;
    public List<Modifier> Modifiers { get; set; } = new();
}

public class Modifier
{
    public Guid Id { get; set; }
    public Guid GroupId { get; set; }
    public string Name { get; set; } = string.Empty;
    // VAT-inclusive change to the line's unit price.
    public decimal PriceDelta { get; set; }
    // Recipe change: this ingredient, this much more (or less, negative) per unit of the dish.
    public Guid? IngredientItemId { get; set; }
    public decimal? IngredientQuantity { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

// Which modifier groups an item offers.
public class ItemModifierGroup
{
    public Guid ItemId { get; set; }
    public Guid GroupId { get; set; }
    public int SortOrder { get; set; }
}

// A combo is an item with slots; each slot offers a choice of items (with an optional surcharge).
public class ComboSlot
{
    public Guid Id { get; set; }
    public Guid ComboItemId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int MinSelect { get; set; } = 1;
    public int MaxSelect { get; set; } = 1;
    public int SortOrder { get; set; }
    public List<ComboChoice> Choices { get; set; } = new();
}

public class ComboChoice
{
    public Guid Id { get; set; }
    public Guid SlotId { get; set; }
    public Guid ItemId { get; set; }
    public decimal PriceDelta { get; set; }
}

// What goes to one production centre when lines are sent (or voided after sending: a STORNO
// ticket), and where the kitchen screen has it.
public enum KitchenTicketState
{
    New,
    InProgress,
    Ready,
    Done,
}

public class KitchenTicket
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid StoreId { get; set; }
    public Guid TabId { get; set; }
    public Guid? ProductionCenterId { get; set; }
    public int Number { get; set; }
    public bool IsStorno { get; set; }
    public KitchenTicketState State { get; set; }
    public string TabLabel { get; set; } = string.Empty;
    public string WaiterName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? ReadyAt { get; set; }
    public DateTime? DoneAt { get; set; }
    public List<KitchenTicketLine> Lines { get; set; } = new();
}

public class KitchenTicketLine
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Guid TabLineId { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public string? Modifiers { get; set; }
    public string? Note { get; set; }
    public int? Seat { get; set; }
    public int Course { get; set; }
}
