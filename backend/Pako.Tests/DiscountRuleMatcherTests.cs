using Pako.Domain.Invoicing;

namespace Pako.Tests;

// Client feedback 2026-11: the period discount rule a line gets.
public class DiscountRuleMatcherTests
{
    private static readonly Guid Customer = Guid.NewGuid();
    private static readonly Guid OtherCustomer = Guid.NewGuid();
    private static readonly Guid Coffee = Guid.NewGuid();
    private static readonly Guid Drinks = Guid.NewGuid();
    private static readonly DateOnly June1 = new(2026, 6, 1);
    private static readonly DateOnly June30 = new(2026, 6, 30);

    private static DiscountRule Rule(decimal percent, Guid? partner = null, Guid? category = null, Guid? item = null, int priority = 0) => new()
    {
        Id = Guid.NewGuid(), Name = $"{percent}%", Percent = percent, PartnerId = partner, ItemCategoryId = category, ItemId = item,
        ValidFrom = June1, ValidTo = June30, Priority = priority
    };

    [Theory]
    [InlineData(2026, 5, 31, false)]
    [InlineData(2026, 6, 1, true)]
    [InlineData(2026, 6, 30, true)]
    [InlineData(2026, 7, 1, false)]
    public void Period_IncludesBothEnds(int y, int m, int d, bool applies)
    {
        var rule = Rule(10m, category: Drinks);
        var match = DiscountRuleMatcher.Match(new[] { rule }, new DateOnly(y, m, d), Customer, Coffee, Drinks);
        Assert.Equal(applies, match is not null);
    }

    [Fact]
    public void CustomerAndCategory_AppliesOnlyToThatCustomersItemsInTheCategory()
    {
        var rule = Rule(7m, partner: Customer, category: Drinks);

        Assert.Same(rule, DiscountRuleMatcher.Match(new[] { rule }, June1, Customer, Coffee, Drinks));
        Assert.Null(DiscountRuleMatcher.Match(new[] { rule }, June1, OtherCustomer, Coffee, Drinks));
        Assert.Null(DiscountRuleMatcher.Match(new[] { rule }, June1, Customer, Coffee, null));
        Assert.Null(DiscountRuleMatcher.Match(new[] { rule }, June1, null, Coffee, Drinks));
    }

    [Fact]
    public void MostSpecificWins_ThenPriority_NoStacking()
    {
        var category = Rule(5m, category: Drinks, priority: 9);
        var customer = Rule(8m, partner: Customer);
        var customerCategory = Rule(10m, partner: Customer, category: Drinks);
        var customerItem = Rule(12m, partner: Customer, item: Coffee);
        var all = new[] { category, customer, customerCategory, customerItem };

        Assert.Same(customerItem, DiscountRuleMatcher.Match(all, June1, Customer, Coffee, Drinks));
        Assert.Same(customerCategory, DiscountRuleMatcher.Match(all.Except(new[] { customerItem }), June1, Customer, Coffee, Drinks));
        Assert.Same(category, DiscountRuleMatcher.Match(all, June1, OtherCustomer, Coffee, Drinks));

        var higher = Rule(6m, category: Drinks, priority: 10);
        Assert.Same(higher, DiscountRuleMatcher.Match(new[] { category, higher }, June1, null, Coffee, Drinks));
    }

    [Fact]
    public void InactiveAndTargetlessRules_NeverApply()
    {
        var inactive = Rule(10m, category: Drinks);
        inactive.IsActive = false;
        var targetless = Rule(10m);

        Assert.Null(DiscountRuleMatcher.Match(new[] { inactive, targetless }, June1, Customer, Coffee, Drinks));
    }
}
