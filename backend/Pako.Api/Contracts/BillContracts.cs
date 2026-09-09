using Pako.Domain.Bills;

namespace Pako.Api.Contracts;

public record CreateBillLineRequest(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid? ExpenseAccountId,
    decimal? DiscountPercent = null);

public record CreateBillRequest(
    Guid PartnerId,
    string? VendorReference,
    DateOnly IssueDate,
    DateOnly DueDate,
    List<CreateBillLineRequest> Lines,
    DocumentType DocumentType = DocumentType.Bill,
    Guid? OriginalBillId = null);

// A5 (v2 release): mirror of UpdateInvoiceRequest — see its doc comment for the full rationale.
public record UpdateBillRequest(
    Guid PartnerId,
    string? VendorReference,
    DateOnly IssueDate,
    DateOnly DueDate,
    List<CreateBillLineRequest> Lines,
    DocumentType DocumentType,
    Guid? OriginalBillId,
    string? InternalNotes);

// A5 (v2 release): mirror of EditPostedInvoiceRequest.
public record EditPostedBillRequest(DateOnly DueDate, string? InternalNotes);

public record BillLineResponse(
    Guid Id,
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    Guid? TaxDefinitionId,
    Guid ExpenseAccountId,
    decimal DiscountPercent);

public record BillResponse(
    Guid Id,
    Guid PartnerId,
    string? VendorReference,
    DateOnly IssueDate,
    DateOnly DueDate,
    string State,
    DocumentType DocumentType,
    Guid? OriginalBillId,
    Guid? JournalEntryId,
    List<BillLineResponse> Lines,
    string? InternalNotes);
