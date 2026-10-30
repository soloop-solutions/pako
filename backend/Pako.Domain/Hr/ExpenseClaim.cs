namespace Pako.Domain.Hr;

public enum ExpenseClaimState
{
    Draft,
    Submitted,
    Approved,
    Rejected,
    Cancelled
}

// H13: out-of-pocket spending an employee asks the company to repay. Approval turns it into a
// Draft purchase bill to the employee (as a partner) — the accountant reviews and posts it through
// the normal bill flow, so VAT, the purchase book and every posting rule apply unchanged. The
// claim then follows its bill: posted, then reimbursed by a bill payment or through payroll.
public class ExpenseClaim
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public string Title { get; set; } = string.Empty;
    public ExpenseClaimState State { get; set; } = ExpenseClaimState.Draft;
    public DateTime? SubmittedAt { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }

    // Set on approval: the Draft bill created for this claim.
    public Guid? BillId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<ExpenseClaimLine> Lines { get; set; } = new();

    // Gross amounts as paid (receipts include VAT).
    public decimal Total => Lines.Sum(l => l.Amount);

    public bool IsEditable => State == ExpenseClaimState.Draft;

    public void Submit(DateTime now)
    {
        if (State != ExpenseClaimState.Draft) throw new InvalidOperationException($"Expense claim {Id} is {State}; only a Draft can be submitted.");
        if (Lines.Count == 0) throw new InvalidOperationException($"Expense claim {Id} has no lines.");
        State = ExpenseClaimState.Submitted;
        SubmittedAt = now;
    }

    public void Decide(bool approve, Guid userId, string? note, DateTime now)
    {
        if (State != ExpenseClaimState.Submitted) throw new InvalidOperationException($"Expense claim {Id} is {State}; only a Submitted claim can be decided.");
        State = approve ? ExpenseClaimState.Approved : ExpenseClaimState.Rejected;
        DecidedByUserId = userId;
        DecidedAt = now;
        DecisionNote = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
    }
}

public class ExpenseClaimLine
{
    public Guid Id { get; set; }
    public Guid ExpenseClaimId { get; set; }
    public DateOnly Date { get; set; }
    public string Description { get; set; } = string.Empty;

    // Expense account the bill line posts to (e.g. 600500 travel per diem).
    public Guid ExpenseAccountId { get; set; }

    // What was paid, VAT included.
    public decimal Amount { get; set; }

    // Input VAT on the receipt, if it is claimable; the bill line uses it with gross pricing.
    public Guid? TaxDefinitionId { get; set; }

    // Who issued the receipt (shop/restaurant) — carried to the bill line for the purchase book.
    public string? SupplierName { get; set; }
    public string? SupplierFiscalNumber { get; set; }
}
