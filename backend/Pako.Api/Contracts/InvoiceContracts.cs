using Pako.Domain.Invoicing;

namespace Pako.Api.Contracts;

public record CreateInvoiceLineRequest(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid? RevenueAccountId,
    decimal? DiscountPercent = null,
    Guid? ItemId = null);

public record CreateInvoiceRequest(
    Guid PartnerId,
    DateOnly IssueDate,
    DateOnly DueDate,
    List<CreateInvoiceLineRequest> Lines,
    DocumentType DocumentType = DocumentType.Invoice,
    Guid? OriginalInvoiceId = null,
    PriceMode PriceMode = PriceMode.GrossInclusive,
    int? PaymentTermDays = null,
    int? GraceDays = null,
    CreateInvoicePaymentRequest? Payment = null);

// C3: optional inline payment recorded atomically with the invoice's own creation+posting — see
// InvoicesController.Create's comment for why this must post the invoice (not leave it Draft).
public record CreateInvoicePaymentRequest(decimal Amount, Guid PaymentMethodId, DateOnly? Date = null);

// A5 (v2 release): same shape as CreateInvoiceRequest plus InternalNotes — full replace, Draft
// documents only (InvoicesController.Update, PUT). A Posted document can't reach this at all;
// see EditPostedInvoiceRequest for the separate, narrower path a Posted document actually uses —
// two distinct request shapes rather than one shape with a runtime field-by-field diff, so the
// Posted path is structurally incapable of expressing a partner/line/amount change.
public record UpdateInvoiceRequest(
    Guid PartnerId,
    DateOnly IssueDate,
    DateOnly DueDate,
    List<CreateInvoiceLineRequest> Lines,
    DocumentType DocumentType,
    Guid? OriginalInvoiceId,
    string? InternalNotes);

// A5 (v2 release): the entire editable surface of a Posted invoice — see UpdateInvoiceRequest's
// doc comment for why this is a separate, narrower type rather than reusing UpdateInvoiceRequest
// with a diff check.
public record EditPostedInvoiceRequest(DateOnly DueDate, string? InternalNotes);

public record InvoiceLineResponse(
    Guid Id,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid RevenueAccountId,
    decimal DiscountPercent,
    Guid? ItemId);

public record InvoiceResponse(
    Guid Id,
    Guid PartnerId,
    string? InvoiceNumber,
    DateOnly IssueDate,
    DateOnly DueDate,
    string State,
    DocumentType DocumentType,
    Guid? OriginalInvoiceId,
    Guid? JournalEntryId,
    List<InvoiceLineResponse> Lines,
    string? InternalNotes,
    PriceMode PriceMode,
    int? PaymentTermDays,
    int? GraceDays);
