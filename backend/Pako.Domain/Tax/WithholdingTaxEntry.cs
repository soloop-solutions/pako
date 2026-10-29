namespace Pako.Domain.Tax;

public class WithholdingTaxEntry
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public int Year { get; set; }
    public string PersonalNumber { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public decimal GrossInterest { get; set; }
    public decimal PropertyRights { get; set; }
    public decimal LotteryWinnings { get; set; }
    public decimal GrossRent { get; set; }
    public decimal NonResidentEntertainer { get; set; }
    public decimal NonResidentServices { get; set; }
    public decimal NonEntrepreneur { get; set; }
    public decimal? RentalAreaM2 { get; set; }
    public decimal? MonthlyGrossRent { get; set; }
    public string Country { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public decimal WithheldTax(decimal standardRate) =>
        Round((GrossInterest + PropertyRights + LotteryWinnings) * standardRate);

    public decimal NonResidentWithheldTax(decimal nonResidentRate) =>
        Round((NonResidentEntertainer + NonResidentServices) * nonResidentRate);

    private static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}
