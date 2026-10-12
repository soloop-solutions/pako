namespace Pako.Localization.Xk;

public static class WithholdingDeclarationRates
{
    public static decimal Standard => RateFor("Interest");

    public static decimal NonResident => RateFor("NonResidentServices");

    private static decimal RateFor(string category) =>
        KosovoWithholdingRates.Rates.Single(r => r.Category == category).Rate;
}
