namespace Pako.Api.Contracts;

public record CreatePartnerRequest(string Name, string? TaxNumber, bool IsCustomer, bool IsVendor);

public record PartnerResponse(Guid Id, string Name, string? TaxNumber, bool IsCustomer, bool IsVendor);
