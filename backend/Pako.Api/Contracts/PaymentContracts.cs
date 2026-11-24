namespace Pako.Api.Contracts;

public record PaymentResponse(
    Guid Id,
    string Direction,
    Guid PartnerId,
    string? PartnerName,
    decimal Amount,
    DateOnly Date,
    string? Reference,
    string State,
    Guid? InvoiceId,
    Guid? BillId,
    string? DocumentNumber,
    Guid DestinationAccountId,
    string? DestinationAccountName,
    Guid? BankStatementLineId,
    DateTime CreatedAt);

public record PaymentListResponse(List<PaymentResponse> Items, int Total, int Page, int PageSize);
