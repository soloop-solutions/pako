namespace Pako.Api.Contracts;

public record CreateInvoiceLineRequest(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid? RevenueAccountId);

public record CreateInvoiceRequest(Guid PartnerId, DateOnly IssueDate, DateOnly DueDate, List<CreateInvoiceLineRequest> Lines);

public record InvoiceLineResponse(
    Guid Id,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid RevenueAccountId);

public record InvoiceResponse(
    Guid Id,
    Guid PartnerId,
    string? InvoiceNumber,
    DateOnly IssueDate,
    DateOnly DueDate,
    string State,
    Guid? JournalEntryId,
    List<InvoiceLineResponse> Lines);
