namespace Pako.Domain.Pos;

// docs/POS_PLAN.md P2: prices a basket's promotions, coupons and loyalty redemption. Runs on the
// server for the quote and again for the order, so what the till shows is what gets recorded.
// Every amount is a VAT-inclusive line discount, rounded to the cent and never more than the line.
public static class ProgramEngine
{
    public record Line(Guid? ItemId, Guid? CategoryId, decimal Quantity, decimal UnitPrice, decimal ManualDiscount);

    public record Context(DateTime LocalNow, Guid StoreId, IReadOnlyCollection<string> Codes, decimal RedeemPoints = 0m);

    public record Applied(Guid ProgramId, string Name, decimal Discount);

    public record Result(IReadOnlyList<decimal> Discounts, IReadOnlyList<Guid?> ProgramIds, IReadOnlyList<Applied> Applied,
        decimal PointsRedeemed, IReadOnlyList<string> UnusedCodes);

    private static decimal Money(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    public static bool Runs(PosProgram p, DateTime localNow, Guid storeId)
    {
        if (!p.IsActive || p.MaxUses is { } max && p.Uses >= max) return false;
        var today = DateOnly.FromDateTime(localNow);
        if (p.ValidFrom is { } from && today < from) return false;
        if (p.ValidTo is { } to && today > to) return false;
        // Monday = bit 0 … Sunday = bit 6.
        var day = ((int)localNow.DayOfWeek + 6) % 7;
        if (p.Days != 0 && (p.Days & (1 << day)) == 0) return false;
        var time = TimeOnly.FromDateTime(localNow);
        if (p.TimeFrom is { } tf && p.TimeTo is { } tt)
        {
            // A window may run past midnight (22:00–02:00).
            var inside = tf <= tt ? time >= tf && time < tt : time >= tf || time < tt;
            if (!inside) return false;
        }
        return p.StoreId is null || p.StoreId == storeId;
    }

    private static bool Targets(PosProgram p, Line line) =>
        p.Targets.Count == 0
        || p.Targets.Any(t => (t.ItemId != null && t.ItemId == line.ItemId) || (t.CategoryId != null && t.CategoryId == line.CategoryId));

    public static Result Apply(IReadOnlyList<Line> lines, IEnumerable<PosProgram> programs, Context context)
    {
        var remaining = lines.Select(l => Money(l.Quantity * l.UnitPrice) - Money(l.ManualDiscount)).ToArray();
        var discounts = new decimal[lines.Count];
        var programIds = new Guid?[lines.Count];
        var touched = lines.Select(l => l.ManualDiscount > 0).ToArray();
        var applied = new List<Applied>();
        var codes = context.Codes.Select(c => c.Trim().ToUpperInvariant()).Where(c => c.Length > 0).ToHashSet();
        var usedCodes = new HashSet<string>();

        var running = programs.Where(p => p.Kind != ProgramKind.Loyalty && Runs(p, context.LocalNow, context.StoreId))
            .Where(p => p.Kind != ProgramKind.Coupon || (p.Code is { } code && codes.Contains(code.ToUpperInvariant())))
            .OrderBy(p => p.Priority).ThenBy(p => p.Name, StringComparer.Ordinal).ToList();

        foreach (var p in running)
        {
            var eligible = Enumerable.Range(0, lines.Count)
                .Where(i => remaining[i] > 0 && (p.Stackable || !touched[i]) && Targets(p, lines[i])).ToList();
            if (eligible.Count == 0) continue;
            if (p.MinQuantity is { } minQty && eligible.Sum(i => lines[i].Quantity) < minQty) continue;
            if (p.MinAmount is { } minAmount && eligible.Sum(i => remaining[i]) < minAmount) continue;

            var d = Reward(p, lines, remaining, eligible);
            var total = d.Values.Sum();
            if (total <= 0) continue;
            foreach (var (i, amount) in d.Where(x => x.Value > 0))
            {
                remaining[i] -= amount;
                discounts[i] += amount;
                touched[i] = true;
                programIds[i] ??= p.Id;
            }
            applied.Add(new Applied(p.Id, p.Name, total));
            if (p.Kind == ProgramKind.Coupon) usedCodes.Add(p.Code!.ToUpperInvariant());
        }

        // Loyalty points redeemed as a discount over the whole basket.
        var pointsRedeemed = 0m;
        var loyalty = programs.FirstOrDefault(p => p.Kind == ProgramKind.Loyalty && Runs(p, context.LocalNow, context.StoreId));
        if (context.RedeemPoints > 0 && loyalty?.PointValue is > 0 && remaining.Sum() > 0)
        {
            var value = Math.Min(Money(context.RedeemPoints * loyalty.PointValue.Value), remaining.Sum());
            var shares = Allocate(value, remaining);
            for (var i = 0; i < lines.Count; i++)
            {
                remaining[i] -= shares[i];
                discounts[i] += shares[i];
                if (shares[i] > 0) programIds[i] ??= loyalty.Id;
            }
            pointsRedeemed = Math.Round(value / loyalty.PointValue.Value, 4, MidpointRounding.AwayFromZero);
            applied.Add(new Applied(loyalty.Id, loyalty.Name, value));
        }

        return new Result(discounts, programIds, applied, pointsRedeemed, codes.Except(usedCodes).ToList());
    }

    // Points a paid amount earns under the loyalty program (whole points, rounded down).
    public static decimal PointsFor(PosProgram loyalty, decimal paid) =>
        loyalty.PointsPerEuro is > 0 && paid > 0 ? Math.Floor(paid * loyalty.PointsPerEuro.Value) : 0m;

    private static Dictionary<int, decimal> Reward(PosProgram p, IReadOnlyList<Line> lines, decimal[] remaining, List<int> eligible)
    {
        var d = eligible.ToDictionary(i => i, _ => 0m);
        switch (p.Reward)
        {
            case ProgramRewardKind.PercentOff when p.Percent is > 0 and <= 100:
                foreach (var i in eligible) d[i] = Math.Min(remaining[i], Money(remaining[i] * p.Percent.Value / 100m));
                break;
            case ProgramRewardKind.AmountOff when p.Amount is > 0:
                foreach (var i in eligible) d[i] = Math.Min(remaining[i], Money(p.Amount.Value * lines[i].Quantity));
                break;
            case ProgramRewardKind.FixedPrice when p.Price is >= 0:
                foreach (var i in eligible) d[i] = Math.Max(0m, Math.Min(remaining[i], remaining[i] - Money(p.Price.Value * lines[i].Quantity)));
                break;
            case ProgramRewardKind.BuyXGetY when p.BuyQuantity is > 0 && p.GetQuantity is > 0:
                {
                    // Whole units only; the cheapest units of each full set are free.
                    var units = Units(lines, eligible);
                    var free = units.Count / (p.BuyQuantity.Value + p.GetQuantity.Value) * p.GetQuantity.Value;
                    foreach (var unit in units.OrderBy(u => u.Price).ThenBy(u => u.Line).Take(free)) d[unit.Line] += unit.Price;
                    foreach (var i in eligible) d[i] = Math.Min(remaining[i], Money(d[i]));
                    break;
                }
            case ProgramRewardKind.MultiBuy when p.BuyQuantity is > 0 && p.Price is >= 0:
                {
                    // Sets of Buy units (the dearest first, in the customer's favour) cost Price each.
                    var units = Units(lines, eligible).OrderByDescending(u => u.Price).ThenBy(u => u.Line).ToList();
                    var sets = units.Count / p.BuyQuantity.Value;
                    var grouped = units.Take(sets * p.BuyQuantity.Value).ToList();
                    var saving = Money(grouped.Sum(u => u.Price) - sets * p.Price.Value);
                    if (saving <= 0) break;
                    var weights = new decimal[lines.Count];
                    foreach (var u in grouped) weights[u.Line] += u.Price;
                    var shares = Allocate(saving, weights.Select((w, i) => Math.Min(w, remaining[i])).ToArray());
                    foreach (var i in eligible) d[i] = shares[i];
                    break;
                }
            case ProgramRewardKind.BasketDiscount:
                {
                    var basket = eligible.Sum(i => remaining[i]);
                    var total = p.Percent is > 0 and <= 100 ? Money(basket * p.Percent.Value / 100m)
                        : p.Amount is > 0 ? Math.Min(p.Amount.Value, basket) : 0m;
                    var weights = new decimal[lines.Count];
                    foreach (var i in eligible) weights[i] = remaining[i];
                    var shares = Allocate(total, weights);
                    foreach (var i in eligible) d[i] = shares[i];
                    break;
                }
        }
        return d;
    }

    private record Unit(int Line, decimal Price);

    private static List<Unit> Units(IReadOnlyList<Line> lines, IEnumerable<int> eligible) =>
        eligible.Where(i => lines[i].Quantity == decimal.Truncate(lines[i].Quantity))
            .SelectMany(i => Enumerable.Repeat(new Unit(i, lines[i].UnitPrice), (int)lines[i].Quantity)).ToList();

    // Shares a total over weights in proportion, to the cent, largest remainders first; no share
    // exceeds its weight.
    public static decimal[] Allocate(decimal total, IReadOnlyList<decimal> weights)
    {
        var shares = new decimal[weights.Count];
        var sum = weights.Where(w => w > 0).Sum();
        if (total <= 0 || sum <= 0) return shares;
        total = Math.Min(Money(total), sum);
        var exact = weights.Select(w => w > 0 ? total * w / sum : 0m).ToArray();
        for (var i = 0; i < shares.Length; i++) shares[i] = Math.Floor(exact[i] * 100m) / 100m;
        var leftover = (int)Math.Round((total - shares.Sum()) * 100m);
        foreach (var i in Enumerable.Range(0, shares.Length).Where(i => weights[i] > 0)
                     .OrderByDescending(i => exact[i] - shares[i]).ThenBy(i => i))
        {
            if (leftover <= 0) break;
            if (shares[i] + 0.01m > weights[i]) continue;
            shares[i] += 0.01m;
            leftover--;
        }
        return shares;
    }
}
