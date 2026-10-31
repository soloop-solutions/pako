namespace Pako.Api.Contracts;

// ---- H13 expense claims ----

public record ExpenseClaimLineRequest(
    DateOnly Date,
    string Description,
    Guid ExpenseAccountId,
    // As paid, VAT included.
    decimal Amount,
    // Claimable input VAT on the receipt, if any.
    Guid? TaxDefinitionId,
    string? SupplierName,
    string? SupplierFiscalNumber);

public record SaveExpenseClaimRequest(string Title, List<ExpenseClaimLineRequest> Lines);

public record ExpenseClaimLineResponse(
    Guid Id,
    DateOnly Date,
    string Description,
    Guid ExpenseAccountId,
    string? ExpenseAccountName,
    decimal Amount,
    Guid? TaxDefinitionId,
    string? SupplierName,
    string? SupplierFiscalNumber);

public record ExpenseClaimResponse(
    Guid Id,
    Guid EmployeeId,
    string EmployeeName,
    string Title,
    // Draft, Submitted, Rejected, Cancelled, then (once approved) BillDraft, Posted, Reimbursed.
    string Stage,
    decimal Total,
    DateTime CreatedAt,
    DateTime? SubmittedAt,
    DateTime? DecidedAt,
    string? DecisionNote,
    Guid? BillId,
    // What the bill still owes the employee (0 until it is posted).
    decimal Outstanding,
    // The unconsumed payroll reimbursement scheduled for it, if any.
    DateOnly? PayrollReimbursementPeriod,
    List<ExpenseClaimLineResponse> Lines,
    List<AttachmentResponse> Receipts);

public record DecideExpenseClaimRequest(string? Note);

public record ReimburseViaPayrollRequest(DateOnly Period);

public record OptionItem(Guid Id, string Label);

// What an employee can pick on a claim line.
public record ExpenseOptionsResponse(List<OptionItem> Accounts, List<OptionItem> Taxes);

// One bound class for the multipart upload — see UploadAttachmentRequest for why.
public class UploadReceiptRequest
{
    public IFormFile? File { get; set; }
}
