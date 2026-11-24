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
    DateTime CreatedAt,
    // Direct payments (2026-11-24): what is not yet applied to an invoice/bill, and to how many
    // documents it has been applied.
    decimal? Unapplied = null,
    int? AppliedCount = null,
    // Outstanding, or a direct cash payment (created reconciled, nothing cleared by a statement).
    bool? CanCancel = null);

public record PaymentListResponse(List<PaymentResponse> Items, int Total, int Page, int PageSize);

// Direct payments (2026-11-24): money received from a customer ("Inbound") or paid to a vendor
// ("Outbound") with no document; optionally applied to the partner's open invoices/bills at once.
public record CreatePaymentRequest(
    string Direction,
    Guid PartnerId,
    decimal Amount,
    Guid CashOrBankAccountId,
    DateOnly Date,
    string? Reference = null,
    List<PaymentAllocationRequest>? Allocations = null);

// Exactly one of InvoiceId (payment received) or BillId (payment made).
public record PaymentAllocationRequest(Guid? InvoiceId, Guid? BillId, decimal Amount);

public record ApplyPaymentRequest(List<PaymentAllocationRequest> Allocations);

// A posted document the payment can apply to. Kind: "Invoice" or "Bill"; Suggested is the server's
// oldest-first share of the amount asked about (0 without one).
public record OpenDocumentResponse(
    Guid DocumentId,
    string Kind,
    string DocumentType,
    string? Number,
    DateOnly IssueDate,
    DateOnly DueDate,
    decimal Total,
    decimal Outstanding,
    decimal Suggested);
