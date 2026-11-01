namespace Pako.Domain.Pos;

// docs/POS_PLAN.md D16 — the one place a till order's money is computed. Prices are VAT-inclusive.
// VAT is computed per tax letter from that letter's gross total — exactly as the fiscal coupon does
// (Pako.Fiscal.Xk.CouponBuilder) — then spread over the letter's lines by largest remainder, so the
// lines, the coupon and the session's journal entry agree to the cent.
public static class PosPricing
{
    public record LineInput(decimal Quantity, decimal UnitPrice, decimal DiscountAmount, string TaxLetter, decimal TaxRate);

    public record LineResult(decimal Gross, decimal Net, decimal Tax);

    public record TaxTotal(string TaxLetter, decimal TaxRate, decimal Gross, decimal Net, decimal Tax);

    public record Result(IReadOnlyList<LineResult> Lines, IReadOnlyList<TaxTotal> Taxes, decimal Total, decimal TotalTax, decimal TotalDiscount);

    public static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    public static Result Compute(IReadOnlyList<LineInput> lines)
    {
        var gross = lines.Select(l =>
        {
            if (l.Quantity <= 0) throw new ArgumentException("Quantities are positive; the order kind gives the direction.");
            if (l.UnitPrice < 0 || l.DiscountAmount < 0) throw new ArgumentException("Prices and discounts can't be negative.");
            var before = Money(l.Quantity * l.UnitPrice);
            if (l.DiscountAmount > before) throw new ArgumentException("A discount can't exceed the line amount.");
            return before - Money(l.DiscountAmount);
        }).ToArray();

        var nets = new decimal[lines.Count];
        var taxes = new List<TaxTotal>();
        foreach (var group in lines.Select((l, i) => (l, i)).GroupBy(x => x.l.TaxLetter).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            var rates = group.Select(x => x.l.TaxRate).Distinct().ToList();
            if (rates.Count != 1) throw new ArgumentException($"Tax letter {group.Key} is used with different rates.");
            var rate = rates[0];
            var letterGross = group.Sum(x => gross[x.i]);
            var letterNet = Money(letterGross / (1 + rate));
            taxes.Add(new TaxTotal(group.Key, rate, letterGross, letterNet, letterGross - letterNet));

            // Spread the letter's net over its lines: exact shares rounded down to the cent, then
            // the leftover cents to the largest remainders (ties to the earlier line).
            var shares = group.Select(x => (x.i, Exact: rate == 0 ? gross[x.i] : gross[x.i] / (1 + rate))).ToList();
            foreach (var (i, exact) in shares) nets[i] = Math.Floor(exact * 100m) / 100m;
            var leftover = (int)Math.Round((letterNet - shares.Sum(s => nets[s.i])) * 100m);
            foreach (var (i, _) in shares.OrderByDescending(s => s.Exact - nets[s.i]).ThenBy(s => s.i).Take(Math.Max(0, leftover)))
            {
                nets[i] += 0.01m;
            }
        }

        var results = gross.Select((g, i) => new LineResult(g, nets[i], g - nets[i])).ToList();
        return new Result(results, taxes, gross.Sum(), taxes.Sum(t => t.Tax), lines.Sum(l => Money(l.DiscountAmount)));
    }
}
