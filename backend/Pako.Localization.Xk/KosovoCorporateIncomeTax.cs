namespace Pako.Localization.Xk;

public record KosovoPresumptiveRate(string Category, decimal RateOnGrossReceipts, SourceConfidence Confidence);

public static class KosovoCorporateIncomeTax
{
    public const decimal StandardRate = 0.10m;
    public const SourceConfidence StandardRateConfidence = SourceConfidence.PrimarySource;

    public const decimal PresumptiveTurnoverThresholdEurPerYear = 30000m;
    public const decimal PresumptiveMinimumPerQuarterEur = 37.50m;

    public static readonly IReadOnlyList<KosovoPresumptiveRate> PresumptiveRates = new List<KosovoPresumptiveRate>
    {
        new("TradeTransportAgriculture", 0.03m, SourceConfidence.NeedsLegalVerification),
        new("Services", 0.09m, SourceConfidence.NeedsLegalVerification),
        new("Rental", 0.10m, SourceConfidence.NeedsLegalVerification)
    };
}
