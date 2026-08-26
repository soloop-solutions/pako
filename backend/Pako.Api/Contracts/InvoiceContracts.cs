using Pako.Domain.Invoicing;

namespace Pako.Api.Contracts;

public record CreateInvoiceLineRequest(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid? RevenueAccountId,
    decimal? DiscountPercent = null);

public record CreateInvoiceRequest(
    Guid PartnerId,
    DateOnly IssueDate,
    DateOnly DueDate,
    List<CreateInvoiceLineRequest> Lines,
    DocumentType DocumentType = DocumentType.Invoice,
    Guid? OriginalInvoiceId = null);

public record InvoiceLineResponse(
    Guid Id,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid RevenueAccountId,
    decimal DiscountPercent);

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
    List<InvoiceLineResponse> Lines);
