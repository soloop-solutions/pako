namespace Pako.Api.Contracts;

public record VatDeclarationBox(string Number, string Section, string Label, decimal? Base, decimal? Vat);

public record VatDeclarationResponse(
    int Year,
    int Month,
    string? TaxpayerName,
    string? FiscalNumber,
    string? Address,
    List<VatDeclarationBox> Boxes,
    decimal TotalVatCalculated,
    decimal TotalVatDeductible,
    decimal CarriedCredit,
    decimal RemainingCredit,
    decimal RefundRequested,
    decimal CreditForNextPeriod,
    decimal VatPayable);
