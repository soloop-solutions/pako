namespace Pako.Domain.Pos;

// docs/POS_PLAN.md §12.6 / P2: one engine for promotions, coupons and loyalty. A program says when it
// runs (dates, days, hours, store), what it applies to (items or categories, or the whole basket)
// and what it gives (a reward). Discounts reduce the line's price, so revenue and VAT go down
// together (a price reduction, not an expense).
public enum ProgramKind
{
    // Applies by itself when its conditions are met.
    Promotion,
    // Applies only when the cashier enters its code.
    Coupon,
    // Earns points on sales; points are redeemed as a discount.
    Loyalty,
}

public enum ProgramRewardKind
{
    // Percent off each eligible unit.
    PercentOff,
    // Amount off each eligible unit.
    AmountOff,
    // Eligible units sell at this price.
    FixedPrice,
    // For every Buy + Get units, Get of them (the cheapest) are free.
    BuyXGetY,
    // Every Buy units cost Price together ("3 for €5").
    MultiBuy,
    // A basket of at least MinAmount gets Percent or Amount off, shared over the eligible lines.
    BasketDiscount,
}

public class PosProgram
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public ProgramKind Kind { get; set; }
    public ProgramRewardKind Reward { get; set; }
    public bool IsActive { get; set; } = true;
    // When: valid dates (inclusive), days of the week (bit 0 = Monday … bit 6 = Sunday; 0 = every
    // day), hours (happy hour) and store (null = every store).
    public DateOnly? ValidFrom { get; set; }
    public DateOnly? ValidTo { get; set; }
    public int Days { get; set; }
    public TimeOnly? TimeFrom { get; set; }
    public TimeOnly? TimeTo { get; set; }
    public Guid? StoreId { get; set; }
    // Lower runs first. A non-stackable program leaves alone lines another program already reduced.
    public int Priority { get; set; } = 100;
    public bool Stackable { get; set; }
    // Coupons: the code the cashier enters; a cap on uses (any kind).
    public string? Code { get; set; }
    public int? MaxUses { get; set; }
    public int Uses { get; set; }
    // Conditions and reward figures (which are used depends on Reward).
    public decimal? MinQuantity { get; set; }
    public decimal? MinAmount { get; set; }
    public decimal? Percent { get; set; }
    public decimal? Amount { get; set; }
    public decimal? Price { get; set; }
    public int? BuyQuantity { get; set; }
    public int? GetQuantity { get; set; }
    // Loyalty: points per € paid, and what one point is worth when redeemed.
    public decimal? PointsPerEuro { get; set; }
    public decimal? PointValue { get; set; }
    // What it applies to: these items and categories; none = the whole basket.
    public List<PosProgramTarget> Targets { get; set; } = new();
}

public class PosProgramTarget
{
    public Guid Id { get; set; }
    public Guid ProgramId { get; set; }
    public Guid? ItemId { get; set; }
    public Guid? CategoryId { get; set; }
}

// A customer's loyalty card: the points it holds.
public class LoyaltyCard
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Number { get; set; } = string.Empty;
    public string? HolderName { get; set; }
    public string? Phone { get; set; }
    public Guid? PartnerId { get; set; }
    public decimal Points { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum GiftCardKind
{
    GiftCard,
    // Issued by a refund instead of cash.
    StoreCredit,
    // A customer order's deposit (layaway, special order), spent when the goods are collected.
    Deposit,
}

// A prepaid balance (a liability until spent): gift cards sold at the till and store credit given
// on returns. Each change is a movement, so the balance can always be explained.
public class GiftCard
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Number { get; set; } = string.Empty;
    public GiftCardKind Kind { get; set; }
    public decimal Balance { get; set; }
    public DateOnly? ExpiresOn { get; set; }
    public Guid? PartnerId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<GiftCardMovement> Movements { get; set; } = new();
}

public class GiftCardMovement
{
    public Guid Id { get; set; }
    public Guid GiftCardId { get; set; }
    public Guid? OrderId { get; set; }
    // Positive: loaded (sold, refunded to); negative: spent.
    public decimal Amount { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}
