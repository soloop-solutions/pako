namespace Pako.Api.Contracts;

public record CreateBillLineRequest(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid? ExpenseAccountId);

public record CreateBillRequest(Guid PartnerId, string? VendorReference, DateOnly IssueDate, DateOnly DueDate, List<CreateBillLineRequest> Lines);

public record BillLineResponse(
    Guid Id,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid ExpenseAccountId);

public record BillResponse(
    Guid Id,
    Guid PartnerId,
    string? VendorReference,
    DateOnly IssueDate,
    DateOnly DueDate,
    string State,
    Guid? JournalEntryId,
    List<BillLineResponse> Lines);
