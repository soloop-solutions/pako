namespace Pako.Api.Contracts;

public record CreatePartnerRequest(
    string Name,
    string? TaxNumber,
    bool IsCustomer,
    bool IsVendor,
    string? FiscalNumber = null,
    bool IsVatRegistered = false);

public record PartnerResponse(
    Guid Id,
    string Name,
    string? TaxNumber,
    bool IsCustomer,
    bool IsVendor,
    string? FiscalNumber,
    bool IsVatRegistered);
