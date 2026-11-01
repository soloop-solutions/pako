namespace Pako.Fiscal.Xk;

// ATK tax letters (AI 01/2026 Art. 29(1.2); ATK samples): A = exempt, C = 0 %, D = 8 %, E = 18 %.
// B is reserved and unused. PAKO's TaxDefinition.Rate is a fraction (0.18), so the mapping is
// explicit rather than a pass-through of a percentage.
public static class TaxLetters
{
    public const string Exempt = "A";
    public const string Zero = "C";
    public const string Reduced = "D";
    public const string Standard = "E";

    public static string For(decimal rate, bool exempt)
    {
        if (exempt) return Exempt;
        return rate switch
        {
            0m => Zero,
            0.08m => Reduced,
            0.18m => Standard,
            _ => throw new FiscalCouponException($"No ATK tax letter for a VAT rate of {rate:P0}."),
        };
    }

    public static decimal RateOf(string letter) => letter switch
    {
        Exempt or Zero => 0m,
        Reduced => 0.08m,
        Standard => 0.18m,
        _ => throw new FiscalCouponException($"Unknown ATK tax letter \"{letter}\"."),
    };
}
