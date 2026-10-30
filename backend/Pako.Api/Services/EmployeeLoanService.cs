using Microsoft.EntityFrameworkCore;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public record LoanBalance(decimal RepaidInRuns, decimal RepaidPosted)
{
    public static readonly LoanBalance None = new(0m, 0m);
}

// G10: what has been recovered on each loan. A repayment counts against the balance as soon as a
// run holds it (so two Draft runs can never both take the last installment); it is final once
// that run is posted.
public class EmployeeLoanService
{
    private readonly PakoDbContext _db;

    public EmployeeLoanService(PakoDbContext db)
    {
        _db = db;
    }

    public async Task<Dictionary<Guid, LoanBalance>> BalancesAsync(IReadOnlyCollection<Guid> loanIds)
    {
        if (loanIds.Count == 0) return new Dictionary<Guid, LoanBalance>();

        var rows = await (
            from a in _db.PayrollAdjustments.AsNoTracking()
            join r in _db.PayrollRuns.AsNoTracking() on a.PayrollRunId equals r.Id
            where a.EmployeeLoanId != null && loanIds.Contains(a.EmployeeLoanId.Value)
            select new { LoanId = a.EmployeeLoanId!.Value, a.Amount, r.State }).ToListAsync();

        return rows.GroupBy(x => x.LoanId).ToDictionary(
            g => g.Key,
            g => new LoanBalance(
                g.Sum(x => x.Amount),
                g.Where(x => x.State is PayrollRunState.Posted or PayrollRunState.Paid).Sum(x => x.Amount)));
    }

    // Unconsumed repayment adjustments for a run, one per active loan that has started and still
    // has a balance. The caller attaches them to the run (PayrollRunComposer).
    public async Task<List<PayrollAdjustment>> RepaymentsForAsync(Guid companyId, IReadOnlyCollection<Guid> employeeIds, DateOnly periodStart, DateOnly periodEnd)
    {
        var loans = await _db.EmployeeLoans.AsNoTracking()
            .Where(l => l.CompanyId == companyId && l.State == EmployeeLoanState.Active &&
                employeeIds.Contains(l.EmployeeId) && l.FirstPeriod <= periodEnd)
            .OrderBy(l => l.IssuedOn)
            .ToListAsync();
        var balances = await BalancesAsync(loans.Select(l => l.Id).ToList());
        var period = new DateOnly(periodStart.Year, periodStart.Month, 1);

        var repayments = new List<PayrollAdjustment>();
        foreach (var loan in loans)
        {
            var outstanding = loan.Principal - balances.GetValueOrDefault(loan.Id, LoanBalance.None).RepaidInRuns;
            var amount = loan.NextInstallment(outstanding);
            if (amount <= 0m) continue;

            repayments.Add(new PayrollAdjustment
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                EmployeeId = loan.EmployeeId,
                Period = period,
                Kind = PayrollAdjustmentKind.LoanRepayment,
                Description = $"{loan.Kind} {loan.IssuedOn:dd.MM.yyyy}",
                Amount = amount,
                EmployeeLoanId = loan.Id
            });
        }

        return repayments;
    }

    // After a run posts: a loan whose posted repayments now cover the principal is settled.
    public async Task SettleRepaidAsync(Guid runId)
    {
        var loanIds = await _db.PayrollAdjustments.AsNoTracking()
            .Where(a => a.PayrollRunId == runId && a.EmployeeLoanId != null)
            .Select(a => a.EmployeeLoanId!.Value)
            .Distinct()
            .ToListAsync();
        if (loanIds.Count == 0) return;

        var balances = await BalancesAsync(loanIds);
        var loans = await _db.EmployeeLoans.Where(l => loanIds.Contains(l.Id) && l.State == EmployeeLoanState.Active).ToListAsync();
        foreach (var loan in loans)
        {
            if (balances.GetValueOrDefault(loan.Id, LoanBalance.None).RepaidPosted >= loan.Principal)
            {
                loan.State = EmployeeLoanState.Settled;
            }
        }
    }

    // Employee receivables: the company default, else the chart's 111100.
    public async Task<Guid?> AdvancesAccountIdAsync(Guid companyId)
    {
        var configured = await _db.CompanyAccountDefaults.AsNoTracking()
            .Where(d => d.CompanyId == companyId)
            .Select(d => d.EmployeeAdvancesAccountId)
            .FirstOrDefaultAsync();
        if (configured is not null) return configured;

        return await _db.Accounts.AsNoTracking()
            .Where(a => a.CompanyId == companyId && a.Code == "111100")
            .Select(a => (Guid?)a.Id)
            .FirstOrDefaultAsync();
    }
}
