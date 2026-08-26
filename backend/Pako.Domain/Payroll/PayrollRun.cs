using Pako.Domain.Companies;
using Pako.Domain.Ledger;

namespace Pako.Domain.Payroll;

public enum PayrollRunState
{
    Draft,
    Posted
}

public class PayrollRun
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }
    public PayrollRunState State { get; set; } = PayrollRunState.Draft;
    public Guid? JournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<PayslipLine> Lines { get; set; } = new();

    public JournalEntry Post(
        Company company,
        Guid journalId,
        Guid salaryExpenseAccountId,
        Guid pitPayableAccountId,
        Guid pensionPayableAccountId,
        Guid netPayPayableAccountId)
    {
        if (State != PayrollRunState.Draft)
        {
            throw new InvalidOperationException(
                $"Payroll run {Id} cannot be posted from state {State}; only Draft payroll runs can be posted.");
        }

        if (Lines.Count == 0)
        {
            throw new InvalidOperationException($"Payroll run {Id} has no payslip lines.");
        }

        var sumGross = Lines.Sum(l => l.GrossSalary);
        var sumPit = Lines.Sum(l => l.PitAmount);
        var sumEmployeePension = Lines.Sum(l => l.EmployeePensionAmount);
        var sumEmployerPension = Lines.Sum(l => l.EmployerPensionAmount);
        var sumNetPay = Lines.Sum(l => l.NetPay);

        var journalEntry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = CompanyId,
            JournalId = journalId,
            Date = PeriodEnd,
            Reference = $"Payroll {PeriodStart:yyyy-MM-dd}/{PeriodEnd:yyyy-MM-dd}",
            Lines = new List<JournalEntryLine>
            {
                new()
                {
                    Id = Guid.NewGuid(),
                    AccountId = salaryExpenseAccountId,
                    Debit = sumGross + sumEmployerPension,
                    Credit = 0m,
                    Description = "Salary expense"
                },
                new()
                {
                    Id = Guid.NewGuid(),
                    AccountId = pitPayableAccountId,
                    Debit = 0m,
                    Credit = sumPit,
                    Description = "PIT payable"
                },
                new()
                {
                    Id = Guid.NewGuid(),
                    AccountId = pensionPayableAccountId,
                    Debit = 0m,
                    Credit = sumEmployeePension + sumEmployerPension,
                    Description = "Pension payable"
                },
                new()
                {
                    Id = Guid.NewGuid(),
                    AccountId = netPayPayableAccountId,
                    Debit = 0m,
                    Credit = sumNetPay,
                    Description = "Net pay payable"
                }
            }
        };

        journalEntry.Post(company);

        JournalEntryId = journalEntry.Id;
        State = PayrollRunState.Posted;

        return journalEntry;
    }
}
