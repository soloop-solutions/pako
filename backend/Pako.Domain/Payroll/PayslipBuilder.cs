using Pako.Domain.Hr;

namespace Pako.Domain.Payroll;

// Everything the builder needs to know about one employee for one period, already loaded.
public record PayslipEmployeeData(
    Employee Employee,
    EmployeeContract? Contract,
    Department? Department,
    IReadOnlyList<PayrollAdjustment> Adjustments,
    IReadOnlyList<(LeaveRequest Request, LeaveType Type)> ApprovedLeave);

// Turns HR data into a payslip line: prorates base salary by working days employed in the
// period, reduces it for unpaid or part-paid leave, sums adjustments, then runs the statutory
// calculation. Pure — no database — so every rule is unit-testable.
public class PayslipBuilder
{
    private readonly IPayrollCalculationService _calculation;
    private readonly PayrollStatutoryRates _rates;

    public PayslipBuilder(IPayrollCalculationService calculation, PayrollStatutoryRates rates)
    {
        _calculation = calculation;
        _rates = rates;
    }

    public PayslipLine Build(PayslipEmployeeData data, DateOnly periodStart, DateOnly periodEnd, IReadOnlySet<DateOnly> holidays)
    {
        var employee = data.Employee;
        var monthlySalary = data.Contract?.MonthlyGrossSalary ?? employee.MonthlyGrossSalary;

        var periodWorkingDays = WorkingDays.Count(periodStart, periodEnd, holidays);
        var employedFrom = employee.HireDate is { } hire ? WorkingDays.Max(hire, periodStart) : periodStart;
        var employedTo = employee.TerminationDate is { } end ? WorkingDays.Min(end, periodEnd) : periodEnd;
        var employedDays = employedFrom <= employedTo ? WorkingDays.Count(employedFrom, employedTo, holidays) : 0;

        // Each leave day inside the employed window costs (100 − PayPercent)% of a day's pay.
        var unpaidDayEquivalent = 0m;
        foreach (var (request, type) in data.ApprovedLeave)
        {
            if (type.PayPercent >= 100m)
            {
                continue;
            }

            var from = WorkingDays.Max(request.StartDate, employedFrom);
            var to = WorkingDays.Min(request.EndDate, employedTo);
            if (from > to)
            {
                continue;
            }

            unpaidDayEquivalent += WorkingDays.Count(from, to, holidays) * (100m - type.PayPercent) / 100m;
        }

        var paidDays = Math.Max(employedDays - unpaidDayEquivalent, 0m);
        var baseSalary = periodWorkingDays == 0 || paidDays == periodWorkingDays
            ? monthlySalary
            : monthlySalary * paidDays / periodWorkingDays;

        var bonus = data.Adjustments.Where(a => a.IsBonus).Sum(a => a.Amount);
        var otherAdditions = data.Adjustments.Where(a => !a.IsBonus && !a.IsDeduction).Sum(a => a.Amount);
        var deductions = data.Adjustments.Where(a => a.IsDeduction).Sum(a => a.Amount);

        var result = _calculation.Compute(
            new PayslipInput(baseSalary, bonus + otherAdditions, deductions, employee.IsPrimaryEmployer, employee.PensionExempt),
            _rates);

        return new PayslipLine
        {
            Id = Guid.NewGuid(),
            EmployeeId = employee.Id,
            DepartmentId = employee.DepartmentId,
            CostCenterId = data.Department?.CostCenterId,
            BaseSalary = result.BaseSalary,
            WorkingDays = periodWorkingDays,
            PaidDays = paidDays,
            BonusAmount = Math.Round(bonus, 2, MidpointRounding.AwayFromZero),
            OtherAdditionsAmount = result.Additions - Math.Round(bonus, 2, MidpointRounding.AwayFromZero),
            GrossSalary = result.GrossSalary,
            PitAmount = result.PitAmount,
            EmployeePensionAmount = result.EmployeePensionAmount,
            EmployerPensionAmount = result.EmployerPensionAmount,
            DeductionsAmount = result.Deductions,
            NetPay = result.NetPay,
            IsPrimaryEmployer = employee.IsPrimaryEmployer
        };
    }
}
