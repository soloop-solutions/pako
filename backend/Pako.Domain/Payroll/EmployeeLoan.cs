namespace Pako.Domain.Payroll;

public enum EmployeeLoanKind
{
    // Paid out ahead of salary, usually recovered in one or two runs.
    Advance,
    Loan
}

public enum EmployeeLoanState
{
    Active,
    Settled,
    Cancelled
}

// G10: money the company paid an employee that payroll recovers in installments. Issuing posts
// Dr employee receivables (111100) / Cr cash or bank; each payroll run then deducts
// min(installment, outstanding) after tax as a LoanRepayment adjustment, which credits 111100.
public class EmployeeLoan
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public EmployeeLoanKind Kind { get; set; }
    public decimal Principal { get; set; }
    public DateOnly IssuedOn { get; set; }
    public decimal InstallmentAmount { get; set; }

    // First day of the first month payroll starts recovering it.
    public DateOnly FirstPeriod { get; set; }
    public EmployeeLoanState State { get; set; } = EmployeeLoanState.Active;
    public string? Notes { get; set; }
    public Guid? DisbursementJournalEntryId { get; set; }
    public Guid? CancellationJournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Still owed once posted runs' repayments are taken off; a cancelled loan owes nothing.
    public decimal Outstanding(decimal repaidPosted) => State == EmployeeLoanState.Cancelled ? 0m : Principal - repaidPosted;

    // What the next run deducts given what is still owed: the installment, capped at the balance.
    public decimal NextInstallment(decimal outstanding) =>
        State != EmployeeLoanState.Active || outstanding <= 0m ? 0m : Math.Min(InstallmentAmount, outstanding);
}
