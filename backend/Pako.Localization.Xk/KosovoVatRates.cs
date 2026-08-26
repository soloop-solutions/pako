namespace Pako.Localization.Xk;

public record KosovoVatRate(string Name, decimal Rate, string Description, SourceConfidence Confidence);

public static class KosovoVatRates
{
    public const decimal RegistrationThresholdEur = 30000m;
    public const int FilingDueDayOfFollowingMonth = 20;

    public static readonly IReadOnlyList<KosovoVatRate> Rates = new List<KosovoVatRate>
    {
        new("Standard", 0.18m, "Standard rate on most goods and services", SourceConfidence.PrimarySource),
        new("Reduced", 0.08m, "Basic foodstuffs, water, electricity/heating/waste collection, medicines, books, IT equipment, disability aids (Law 05/L-037)", SourceConfidence.PrimarySource),
        new("Exempt", 0.00m, "Health, education, finance, real estate", SourceConfidence.PrimarySource)
    };
}
