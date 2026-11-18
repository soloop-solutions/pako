using Pako.Domain.Companies;

namespace Pako.Api.Contracts;

public record CreatePartnerRequest(
    string Name,
    string? TaxNumber,
    bool IsCustomer,
    bool IsVendor,
    string? FiscalNumber = null,
    bool IsVatRegistered = false,
    Guid? ReceivableAccountId = null,
    Guid? PayableAccountId = null,
    int? PaymentTermDays = null,
    decimal? CreditLimit = null,
    // docs/POS_PLAN.md P6: the customer's price list and the overdue block (days past due).
    Guid? PriceListId = null,
    int? OverdueBlockDays = null,
    string? Email = null,
    string? Phone = null,
    string? ContactPerson = null,
    string? StreetAddress = null,
    string? City = null,
    string? PostalCode = null,
    string? Country = null,
    // Client feedback 2026-11: retail or wholesale item prices (null on a request = Retail).
    PriceTier? PriceTier = null);

public record UpdatePartnerRequest(
    string Name,
    string? TaxNumber,
    bool IsCustomer,
    bool IsVendor,
    string? FiscalNumber = null,
    bool IsVatRegistered = false,
    Guid? ReceivableAccountId = null,
    Guid? PayableAccountId = null,
    int? PaymentTermDays = null,
    decimal? CreditLimit = null,
    // docs/POS_PLAN.md P6: the customer's price list and the overdue block (days past due).
    Guid? PriceListId = null,
    int? OverdueBlockDays = null,
    string? Email = null,
    string? Phone = null,
    string? ContactPerson = null,
    string? StreetAddress = null,
    string? City = null,
    string? PostalCode = null,
    string? Country = null,
    // Client feedback 2026-11: retail or wholesale item prices (null on a request = Retail).
    PriceTier? PriceTier = null);

public record PartnerResponse(
    Guid Id,
    string Name,
    string? TaxNumber,
    bool IsCustomer,
    bool IsVendor,
    string? FiscalNumber,
    bool IsVatRegistered,
    Guid? ReceivableAccountId,
    Guid? PayableAccountId,
    int? PaymentTermDays,
    decimal? CreditLimit,
    Guid? PriceListId = null,
    int? OverdueBlockDays = null,
    string? Email = null,
    string? Phone = null,
    string? ContactPerson = null,
    string? StreetAddress = null,
    string? City = null,
    string? PostalCode = null,
    string? Country = null,
    // Client feedback 2026-11: retail or wholesale item prices (null on a request = Retail).
    PriceTier? PriceTier = null);

public record CreditExposureResponse(
    decimal? CreditLimit,
    decimal Outstanding,
    decimal? Available);
