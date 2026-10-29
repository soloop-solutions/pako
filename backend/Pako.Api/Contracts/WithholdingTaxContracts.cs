namespace Pako.Api.Contracts;

public record SaveWithholdingTaxEntryRequest(
    int Year,
    string PersonalNumber,
    string Name,
    decimal GrossInterest,
    decimal PropertyRights,
    decimal LotteryWinnings,
    decimal GrossRent,
    decimal NonResidentEntertainer,
    decimal NonResidentServices,
    decimal NonEntrepreneur,
    decimal? RentalAreaM2,
    decimal? MonthlyGrossRent,
    string Country);

public record WithholdingTaxEntryResponse(
    Guid Id,
    int Year,
    string PersonalNumber,
    string Name,
    decimal GrossInterest,
    decimal PropertyRights,
    decimal LotteryWinnings,
    decimal WithheldTax,
    decimal GrossRent,
    decimal NonResidentEntertainer,
    decimal NonResidentServices,
    decimal NonResidentWithheldTax,
    decimal NonEntrepreneur,
    decimal? RentalAreaM2,
    decimal? MonthlyGrossRent,
    string Country);

public record WithholdingTaxTotalsResponse(
    decimal GrossInterest,
    decimal PropertyRights,
    decimal LotteryWinnings,
    decimal WithheldTax,
    decimal GrossRent,
    decimal NonResidentEntertainer,
    decimal NonResidentServices,
    decimal NonResidentWithheldTax,
    decimal NonEntrepreneur);

public record WithholdingTaxListResponse(
    List<WithholdingTaxEntryResponse> Items,
    int Total,
    int Page,
    int PageSize,
    WithholdingTaxTotalsResponse Totals,
    decimal StandardRate,
    decimal NonResidentRate);

public record WithholdingTaxCountryListResponse(List<string> Countries, string DefaultCountry);
