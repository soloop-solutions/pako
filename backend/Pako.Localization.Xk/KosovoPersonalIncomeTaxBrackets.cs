namespace Pako.Localization.Xk;

public record KosovoPersonalIncomeTaxBracket(decimal LowerBoundEurPerYear, decimal? UpperBoundEurPerYear, decimal Rate, SourceConfidence Confidence);

public static class KosovoPersonalIncomeTaxBrackets
{
    public static readonly IReadOnlyList<KosovoPersonalIncomeTaxBracket> Brackets = new List<KosovoPersonalIncomeTaxBracket>
    {
        new(0m, 3000m, 0.00m, SourceConfidence.PrimarySource),
        new(3000.01m, 5400m, 0.08m, SourceConfidence.PrimarySource),
        new(5400.01m, null, 0.10m, SourceConfidence.PrimarySource)
    };
}
