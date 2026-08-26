namespace Pako.Localization.Xk;

public record KosovoWithholdingRate(string Category, decimal Rate, SourceConfidence Confidence);

public static class KosovoWithholdingRates
{
    public static readonly IReadOnlyList<KosovoWithholdingRate> Rates = new List<KosovoWithholdingRate>
    {
        new("Interest", 0.10m, SourceConfidence.NeedsLegalVerification),
        new("Royalties", 0.10m, SourceConfidence.NeedsLegalVerification),
        new("Rent", 0.09m, SourceConfidence.NeedsLegalVerification),
        new("NonResidentServices", 0.05m, SourceConfidence.NeedsLegalVerification),
        new("NonBusinessFarmersRecycledMaterials", 0.01m, SourceConfidence.NeedsLegalVerification),
        new("Dividends", 0.00m, SourceConfidence.NeedsLegalVerification)
    };
}
