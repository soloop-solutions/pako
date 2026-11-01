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
    int? OverdueBlockDays = null);

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
    int? OverdueBlockDays = null);

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
    int? OverdueBlockDays = null);

public record CreditExposureResponse(
    decimal? CreditLimit,
    decimal Outstanding,
    decimal? Available);
