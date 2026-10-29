namespace Pako.Domain.Tax;

public record WithholdingTaxTotals(
    decimal GrossInterest,
    decimal PropertyRights,
    decimal LotteryWinnings,
    decimal WithheldTax,
    decimal GrossRent,
    decimal NonResidentEntertainer,
    decimal NonResidentServices,
    decimal NonResidentWithheldTax,
    decimal NonEntrepreneur)
{
    public static WithholdingTaxTotals Of(IReadOnlyCollection<WithholdingTaxEntry> entries, decimal standardRate, decimal nonResidentRate) => new(
        entries.Sum(e => e.GrossInterest),
        entries.Sum(e => e.PropertyRights),
        entries.Sum(e => e.LotteryWinnings),
        entries.Sum(e => e.WithheldTax(standardRate)),
        entries.Sum(e => e.GrossRent),
        entries.Sum(e => e.NonResidentEntertainer),
        entries.Sum(e => e.NonResidentServices),
        entries.Sum(e => e.NonResidentWithheldTax(nonResidentRate)),
        entries.Sum(e => e.NonEntrepreneur));
}
