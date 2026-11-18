namespace Pako.Domain.Invoicing;

// Picks the one discount rule that applies to a line: the rule must be active, its period must hold
// the document date (both ends inclusive), and each target it sets must match. The most specific
// rule wins — a customer target counts more than an item target, an item more than a category —
// then Priority, then the newest rule. Rules never stack.
public static class DiscountRuleMatcher
{
    public static DiscountRule? Match(IEnumerable<DiscountRule> rules, DateOnly date, Guid? partnerId, Guid itemId, Guid? itemCategoryId) =>
        rules
            .Where(r => r.IsActive && r.ValidFrom <= date && date <= r.ValidTo)
            .Where(r => r.PartnerId is null || r.PartnerId == partnerId)
            .Where(r => r.ItemId is null || r.ItemId == itemId)
            .Where(r => r.ItemCategoryId is null || (itemCategoryId is not null && r.ItemCategoryId == itemCategoryId))
            .Where(r => r.PartnerId is not null || r.ItemId is not null || r.ItemCategoryId is not null)
            .OrderByDescending(Specificity)
            .ThenByDescending(r => r.Priority)
            .ThenByDescending(r => r.CreatedAt)
            .FirstOrDefault();

    // Customer 4, item 2, category 1: customer + item (6) > customer + category (5) > customer (4)
    // > item (2) > category (1).
    public static int Specificity(DiscountRule rule) =>
        (rule.PartnerId is null ? 0 : 4) + (rule.ItemId is null ? 0 : 2) + (rule.ItemCategoryId is null ? 0 : 1);
}
