using Pako.Domain.Companies;
using Pako.Domain.Payroll;

namespace Pako.Tests;

public class PayrollRunPostingTests
{
    private static PayrollRun RunWithLines(params PayslipLine[] lines) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = Guid.NewGuid(),
        PeriodStart = new DateOnly(2026, 8, 1),
        PeriodEnd = new DateOnly(2026, 8, 31),
        Lines = lines.ToList()
    };

    [Fact]
    public void Post_ValidRun_ProducesBalancedEntryWithCorrectSplit()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var salaryExpenseAccountId = Guid.NewGuid();
        var pitPayableAccountId = Guid.NewGuid();
        var pensionPayableAccountId = Guid.NewGuid();
        var netPayPayableAccountId = Guid.NewGuid();

        var run = RunWithLines(
            new PayslipLine
            {
                Id = Guid.NewGuid(),
                EmployeeId = Guid.NewGuid(),
                GrossSalary = 500m,
                PitAmount = 18.50m,
                EmployeePensionAmount = 25m,
                EmployerPensionAmount = 25m,
                NetPay = 456.50m
            },
            new PayslipLine
            {
                Id = Guid.NewGuid(),
                EmployeeId = Guid.NewGuid(),
                GrossSalary = 200m,
                PitAmount = 0m,
                EmployeePensionAmount = 10m,
                EmployerPensionAmount = 10m,
                NetPay = 190m
            });

        var journalEntry = run.Post(company, Guid.NewGuid(), salaryExpenseAccountId, pitPayableAccountId, pensionPayableAccountId, netPayPayableAccountId);

        Assert.Equal(PayrollRunState.Posted, run.State);
        Assert.Equal(run.JournalEntryId, journalEntry.Id);
        Assert.Equal(journalEntry.Lines.Sum(l => l.Debit), journalEntry.Lines.Sum(l => l.Credit));

        var salaryExpenseLine = Assert.Single(journalEntry.Lines, l => l.AccountId == salaryExpenseAccountId);
        Assert.Equal(700m + 35m, salaryExpenseLine.Debit);

        var pitLine = Assert.Single(journalEntry.Lines, l => l.AccountId == pitPayableAccountId);
        Assert.Equal(18.50m, pitLine.Credit);

        var pensionLine = Assert.Single(journalEntry.Lines, l => l.AccountId == pensionPayableAccountId);
        Assert.Equal(35m + 35m, pensionLine.Credit);

        var netPayLine = Assert.Single(journalEntry.Lines, l => l.AccountId == netPayPayableAccountId);
        Assert.Equal(646.50m, netPayLine.Credit);
    }

    [Fact]
    public void Post_EmptyPayrollRun_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var run = RunWithLines();

        var ex = Assert.Throws<InvalidOperationException>(() =>
            run.Post(company, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()));

        Assert.Contains("has no payslip lines", ex.Message);
        Assert.Equal(PayrollRunState.Draft, run.State);
    }

    [Fact]
    public void Post_AlreadyPostedRun_Throws()
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Test Co" };
        var run = RunWithLines(new PayslipLine
        {
            Id = Guid.NewGuid(),
            EmployeeId = Guid.NewGuid(),
            GrossSalary = 200m,
            PitAmount = 0m,
            EmployeePensionAmount = 10m,
            EmployerPensionAmount = 10m,
            NetPay = 190m
        });
        run.Post(company, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

        Assert.Throws<InvalidOperationException>(() =>
            run.Post(company, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()));
    }
}
