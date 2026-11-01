using Pako.Domain.Pos;

namespace Pako.Tests;

// docs/POS_PLAN.md P2: the programs engine on its own — no database.
public class ProgramEngineTests
{
    private static readonly Guid Store = Guid.NewGuid();
    private static readonly Guid Milk = Guid.NewGuid(), Bread = Guid.NewGuid(), Beer = Guid.NewGuid();
    private static readonly Guid Dairy = Guid.NewGuid();
    // A Friday, 18:30.
    private static readonly DateTime Friday = new(2026, 10, 30, 18, 30, 0);

    private static ProgramEngine.Context At(DateTime when, params string[] codes) => new(when, Store, codes);

    private static PosProgram Program(ProgramRewardKind reward, Action<PosProgram>? set = null, params Guid[] items)
    {
        var p = new PosProgram { Id = Guid.NewGuid(), Name = reward.ToString(), Kind = ProgramKind.Promotion, Reward = reward };
        p.Targets = items.Select(i => new PosProgramTarget { Id = Guid.NewGuid(), ProgramId = p.Id, ItemId = i }).ToList();
        set?.Invoke(p);
        return p;
    }

    [Fact]
    public void PercentOff_AppliesToItsItemsOnly()
    {
        var lines = new[] { new ProgramEngine.Line(Milk, Dairy, 2m, 1.10m, 0m), new ProgramEngine.Line(Bread, null, 1m, 0.80m, 0m) };
        var result = ProgramEngine.Apply(lines, new[] { Program(ProgramRewardKind.PercentOff, p => p.Percent = 10m, Milk) }, At(Friday));
        Assert.Equal(new[] { 0.22m, 0m }, result.Discounts);
        Assert.Single(result.Applied);
    }

    [Fact]
    public void BuyTwoGetOneFree_GivesTheCheapestUnit()
    {
        var lines = new[] { new ProgramEngine.Line(Milk, Dairy, 2m, 1.20m, 0m), new ProgramEngine.Line(Beer, null, 1m, 1.00m, 0m) };
        var program = Program(ProgramRewardKind.BuyXGetY, p => { p.BuyQuantity = 2; p.GetQuantity = 1; }, Milk, Beer);
        var result = ProgramEngine.Apply(lines, new[] { program }, At(Friday));
        Assert.Equal(new[] { 0m, 1.00m }, result.Discounts);
    }

    [Fact]
    public void MultiBuy_ThreeForFive_ChargesFiveForEachSet()
    {
        var lines = new[] { new ProgramEngine.Line(Beer, null, 4m, 2.00m, 0m) };
        var program = Program(ProgramRewardKind.MultiBuy, p => { p.BuyQuantity = 3; p.Price = 5m; }, Beer);
        var result = ProgramEngine.Apply(lines, new[] { program }, At(Friday));
        // 3 × 2.00 = 6.00 becomes 5.00; the fourth beer is full price.
        Assert.Equal(1.00m, result.Discounts[0]);
    }

    [Fact]
    public void Coupons_NeedTheirCode_AndCodesThatMatchNothingAreReported()
    {
        var lines = new[] { new ProgramEngine.Line(Milk, Dairy, 1m, 10m, 0m) };
        var coupon = Program(ProgramRewardKind.AmountOff, p => { p.Kind = ProgramKind.Coupon; p.Code = "VERA5"; p.Amount = 5m; });
        Assert.Equal(0m, ProgramEngine.Apply(lines, new[] { coupon }, At(Friday)).Discounts[0]);
        var used = ProgramEngine.Apply(lines, new[] { coupon }, At(Friday, "vera5", "NOPE"));
        Assert.Equal(5m, used.Discounts[0]);
        Assert.Equal(new[] { "NOPE" }, used.UnusedCodes);
        coupon.MaxUses = 1;
        coupon.Uses = 1;
        Assert.Equal(0m, ProgramEngine.Apply(lines, new[] { coupon }, At(Friday, "VERA5")).Discounts[0]);
    }

    [Fact]
    public void HappyHour_RunsOnlyInsideItsWindowAndDays()
    {
        var lines = new[] { new ProgramEngine.Line(Beer, null, 1m, 2m, 0m) };
        // Fridays (bit 4), 18:00–20:00.
        var happy = Program(ProgramRewardKind.FixedPrice, p => { p.Price = 1.5m; p.Days = 1 << 4; p.TimeFrom = new TimeOnly(18, 0); p.TimeTo = new TimeOnly(20, 0); }, Beer);
        Assert.Equal(0.5m, ProgramEngine.Apply(lines, new[] { happy }, At(Friday)).Discounts[0]);
        Assert.Equal(0m, ProgramEngine.Apply(lines, new[] { happy }, At(Friday.AddHours(2))).Discounts[0]);
        Assert.Equal(0m, ProgramEngine.Apply(lines, new[] { happy }, At(Friday.AddDays(1))).Discounts[0]);
    }

    [Fact]
    public void NonStackablePrograms_LeaveDiscountedLinesAlone_BasketDiscountsShareByAmount()
    {
        var lines = new[] { new ProgramEngine.Line(Milk, Dairy, 1m, 30m, 0m), new ProgramEngine.Line(Bread, null, 1m, 20m, 0m) };
        var first = Program(ProgramRewardKind.PercentOff, p => { p.Percent = 50m; p.Priority = 1; }, Milk);
        // 10 % off a basket of at least 40 (stackable: also on the halved milk).
        var basket = Program(ProgramRewardKind.BasketDiscount, p => { p.Percent = 10m; p.MinAmount = 40m; p.Stackable = true; p.Priority = 2; });
        var result = ProgramEngine.Apply(lines, new[] { first, basket }, At(Friday));
        // Half off the milk leaves a basket of 35: under the 40 threshold, so only the first applies.
        Assert.Equal(new[] { 15m, 0m }, result.Discounts);
        // With a 30 threshold the 3.50 basket discount is shared 15 : 20 → 1.50 and 2.00.
        basket.MinAmount = 30m;
        result = ProgramEngine.Apply(lines, new[] { first, basket }, At(Friday));
        Assert.Equal(new[] { 16.5m, 2m }, result.Discounts);
        // A manual discount keeps a non-stackable program off its line.
        var manual = new[] { new ProgramEngine.Line(Milk, Dairy, 1m, 30m, 1m) };
        Assert.Equal(0m, ProgramEngine.Apply(manual, new[] { first }, At(Friday)).Discounts[0]);
    }

    [Fact]
    public void LoyaltyPoints_AreRedeemedAsADiscount_UpToTheBasket()
    {
        var loyalty = new PosProgram { Id = Guid.NewGuid(), Name = "Points", Kind = ProgramKind.Loyalty, PointsPerEuro = 1m, PointValue = 0.01m };
        var lines = new[] { new ProgramEngine.Line(Milk, Dairy, 1m, 3m, 0m), new ProgramEngine.Line(Bread, null, 1m, 1m, 0m) };
        var result = ProgramEngine.Apply(lines, new[] { loyalty }, new ProgramEngine.Context(Friday, Store, Array.Empty<string>(), 200m));
        Assert.Equal((2m, 200m), (result.Discounts.Sum(), result.PointsRedeemed));
        Assert.Equal(new[] { 1.5m, 0.5m }, result.Discounts);
        // More points than the basket: only what the basket can take.
        result = ProgramEngine.Apply(lines, new[] { loyalty }, new ProgramEngine.Context(Friday, Store, Array.Empty<string>(), 1000m));
        Assert.Equal((4m, 400m), (result.Discounts.Sum(), result.PointsRedeemed));
        Assert.Equal(12m, ProgramEngine.PointsFor(loyalty, 12.99m));
    }

    [Fact]
    public void Allocate_SharesToTheCent_NeverAboveAWeight()
    {
        Assert.Equal(new[] { 0.34m, 0.33m, 0.33m }, ProgramEngine.Allocate(1m, new[] { 1m, 1m, 1m }));
        Assert.Equal(new[] { 0.10m, 0m }, ProgramEngine.Allocate(5m, new[] { 0.10m, 0m }));
    }
}
