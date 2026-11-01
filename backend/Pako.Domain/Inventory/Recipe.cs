namespace Pako.Domain.Inventory;

// docs/POS_PLAN.md §6.2 / §13.2 / P3: a dish (or any Normative item) is made of ingredients. Selling
// one unit at the till issues each ingredient's quantity from stock instead of the dish itself; an
// ingredient may have a recipe of its own (a sauce), expanded in turn. Waste is the share lost in
// preparation, added on top.
public class RecipeLine
{
    public Guid Id { get; set; }
    public Guid ItemId { get; set; }
    public Guid IngredientItemId { get; set; }
    // Per one unit of the dish, in the ingredient's base unit.
    public decimal Quantity { get; set; }
    public decimal WastePercent { get; set; }
    public int SortOrder { get; set; }
}
