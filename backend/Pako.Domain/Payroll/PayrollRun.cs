using Pako.Domain.Companies;
using Pako.Domain.Ledger;

namespace Pako.Domain.Payroll;

// Draft → Approved → Posted → Paid. Draft runs can be recomputed or deleted; Approved freezes
// the slips for review and can go back to Draft; Posted books the accrual; Paid books the bank
// transfer that clears net pay payable.
// Persisted as a string (PayrollRunConfiguration), so member order is free to follow the workflow.
public enum PayrollRunState
{
    Draft,
    Approved,
    Posted,
    Paid
}

// Account roles a payroll accrual posts to. The optional ones fall back to the pre-HR behaviour
// when a company has no account for them: bonuses and employer pension land on salary expense,
// employer pension payable on the (employee) pension payable account, deductions on net pay
// payable.
public record PayrollPostingAccounts(
    Guid SalaryExpenseAccountId,
    Guid PitPayableAccountId,
    Guid PensionPayableAccountId,
    Guid NetPayPayableAccountId,
    Guid? BonusExpenseAccountId = null,
    Guid? EmployerPensionExpenseAccountId = null,
    Guid? EmployerPensionPayableAccountId = null,
    Guid? DeductionsPayableAccountId = null);

public class PayrollRun
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }
    public PayrollRunState State { get; set; } = PayrollRunState.Draft;
    public Guid? JournalEntryId { get; set; }
    public Guid? PaymentJournalEntryId { get; set; }
    public DateOnly? PaidOn { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<PayslipLine> Lines { get; set; } = new();

    public bool IsLocked => State is PayrollRunState.Posted or PayrollRunState.Paid;

    public void Approve(Guid userId)
    {
        if (State != PayrollRunState.Draft)
        {
            throw new InvalidOperationException($"Payroll run {Id} cannot be approved from state {State}; only Draft runs can be approved.");
        }

        if (Lines.Count == 0)
        {
            throw new InvalidOperationException($"Payroll run {Id} has no payslip lines.");
        }

        State = PayrollRunState.Approved;
        ApprovedByUserId = userId;
        ApprovedAt = DateTime.UtcNow;
    }

    public void ReturnToDraft()
    {
        if (State != PayrollRunState.Approved)
        {
            throw new InvalidOperationException($"Payroll run {Id} cannot return to Draft from state {State}.");
        }

        State = PayrollRunState.Draft;
        ApprovedByUserId = null;
        ApprovedAt = null;
    }

    // Kept for callers that only know the four original account roles.
    public JournalEntry Post(
        Company company,
        Guid journalId,
        Guid salaryExpenseAccountId,
        Guid pitPayableAccountId,
        Guid pensionPayableAccountId,
        Guid netPayPayableAccountId) =>
        Post(company, journalId, new PayrollPostingAccounts(
            salaryExpenseAccountId, pitPayableAccountId, pensionPayableAccountId, netPayPayableAccountId));

    public JournalEntry Post(Company company, Guid journalId, PayrollPostingAccounts accounts)
    {
        if (State is not (PayrollRunState.Draft or PayrollRunState.Approved))
        {
            throw new InvalidOperationException(
                $"Payroll run {Id} cannot be posted from state {State}; only Draft or Approved payroll runs can be posted.");
        }

        if (Lines.Count == 0)
        {
            throw new InvalidOperationException($"Payroll run {Id} has no payslip lines.");
        }

        if (Lines.Any(l => l.NetPay < 0m))
        {
            throw new InvalidOperationException($"Payroll run {Id} has a payslip with negative net pay; reduce its deductions.");
        }

        var lines = new List<JournalEntryLine>();

        // Expense lines are split per cost center (the department's, snapshotted on the slip) so
        // salary cost lands in the right analytic bucket. Lines with no cost center stay untagged.
        foreach (var group in Lines.GroupBy(l => l.CostCenterId))
        {
            var distribution = group.Key is { } costCenterId
                ? new Dictionary<Guid, decimal> { [costCenterId] = 100m }
                : null;

            var salary = group.Sum(l => l.GrossSalary - (accounts.BonusExpenseAccountId is null ? 0m : l.BonusAmount));
            var employerPension = group.Sum(l => l.EmployerPensionAmount);
            if (accounts.EmployerPensionExpenseAccountId is null)
            {
                salary += employerPension;
            }

            AddDebit(lines, accounts.SalaryExpenseAccountId, salary, "Salary expense", distribution);

            if (accounts.BonusExpenseAccountId is { } bonusAccountId)
            {
                AddDebit(lines, bonusAccountId, group.Sum(l => l.BonusAmount), "Bonuses", distribution);
            }

            if (accounts.EmployerPensionExpenseAccountId is { } employerExpenseId)
            {
                AddDebit(lines, employerExpenseId, employerPension, "Employer pension contribution", distribution);
            }
        }

        var sumPit = Lines.Sum(l => l.PitAmount);
        var sumEmployeePension = Lines.Sum(l => l.EmployeePensionAmount);
        var sumEmployerPension = Lines.Sum(l => l.EmployerPensionAmount);
        var sumDeductions = Lines.Sum(l => l.DeductionsAmount);
        var sumNetPay = Lines.Sum(l => l.NetPay);

        AddCredit(lines, accounts.PitPayableAccountId, sumPit, "PIT payable");
        if (accounts.EmployerPensionPayableAccountId is { } employerPayableId)
        {
            AddCredit(lines, accounts.PensionPayableAccountId, sumEmployeePension, "Pension payable - employee");
            AddCredit(lines, employerPayableId, sumEmployerPension, "Pension payable - employer");
        }
        else
        {
            AddCredit(lines, accounts.PensionPayableAccountId, sumEmployeePension + sumEmployerPension, "Pension payable");
        }

        if (accounts.DeductionsPayableAccountId is { } deductionsId)
        {
            AddCredit(lines, deductionsId, sumDeductions, "Payroll deductions");
            AddCredit(lines, accounts.NetPayPayableAccountId, sumNetPay, "Net pay payable");
        }
        else
        {
            AddCredit(lines, accounts.NetPayPayableAccountId, sumNetPay + sumDeductions, "Net pay payable");
        }

        var journalEntry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = CompanyId,
            JournalId = journalId,
            Date = PeriodEnd,
            Reference = $"Payroll {PeriodStart:yyyy-MM-dd}/{PeriodEnd:yyyy-MM-dd}",
            Lines = lines
        };

        journalEntry.Post(company);

        JournalEntryId = journalEntry.Id;
        State = PayrollRunState.Posted;

        return journalEntry;
    }

    // Net pay leaves the bank: Dr net pay payable / Cr bank. Deductions stay on their liability
    // account — they're paid to whoever they're owed to separately.
    public JournalEntry Pay(Company company, Guid journalId, DateOnly paidOn, Guid netPayPayableAccountId, Guid cashOrBankAccountId)
    {
        if (State != PayrollRunState.Posted)
        {
            throw new InvalidOperationException($"Payroll run {Id} cannot be paid from state {State}; only Posted runs can be paid.");
        }

        var sumNetPay = Lines.Sum(l => l.NetPay);
        var journalEntry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = CompanyId,
            JournalId = journalId,
            Date = paidOn,
            Reference = $"Salary payment {PeriodStart:yyyy-MM-dd}/{PeriodEnd:yyyy-MM-dd}",
            Lines = new List<JournalEntryLine>
            {
                new() { Id = Guid.NewGuid(), AccountId = netPayPayableAccountId, Debit = sumNetPay, Credit = 0m, Description = "Net pay payable" },
                new() { Id = Guid.NewGuid(), AccountId = cashOrBankAccountId, Debit = 0m, Credit = sumNetPay, Description = "Salary payment" }
            }
        };

        journalEntry.Post(company);

        PaymentJournalEntryId = journalEntry.Id;
        PaidOn = paidOn;
        State = PayrollRunState.Paid;

        return journalEntry;
    }

    private static void AddDebit(List<JournalEntryLine> lines, Guid accountId, decimal amount, string description, Dictionary<Guid, decimal>? distribution)
    {
        if (amount == 0m)
        {
            return;
        }

        lines.Add(new JournalEntryLine
        {
            Id = Guid.NewGuid(),
            AccountId = accountId,
            Debit = amount,
            Credit = 0m,
            Description = description,
            AnalyticDistribution = distribution is null ? null : new Dictionary<Guid, decimal>(distribution)
        });
    }

    // Credits are always written, even at zero, for the four original roles — existing tests and
    // reports expect a PIT line on a payroll entry where nobody crosses the 0% band.
    private static void AddCredit(List<JournalEntryLine> lines, Guid accountId, decimal amount, string description)
    {
        lines.Add(new JournalEntryLine
        {
            Id = Guid.NewGuid(),
            AccountId = accountId,
            Debit = 0m,
            Credit = amount,
            Description = description
        });
    }
}
