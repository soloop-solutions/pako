using Microsoft.EntityFrameworkCore;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public record ComposedPayroll(List<PayslipLine> Lines, List<PayrollAdjustment> ConsumedAdjustments, List<string> Warnings, PayrollParameters Parameters);

// Loads everything a payroll period depends on — employees employed in it, the contract in force,
// departments, unconsumed adjustments, approved leave, public holidays — and hands each employee
// to the pure PayslipBuilder. Orchestration only; every amount comes from the domain.
public class PayrollRunComposer
{
    private readonly PakoDbContext _db;
    private readonly IPayrollCalculationService _calculation;
    private readonly PayrollParameterProvider _parameters;
    private readonly EmployeeLoanService _loans;

    public PayrollRunComposer(
        PakoDbContext db, IPayrollCalculationService calculation, PayrollParameterProvider parameters, EmployeeLoanService? loans = null)
    {
        _db = db;
        _calculation = calculation;
        _parameters = parameters;
        _loans = loans ?? new EmployeeLoanService(db);
    }

    public async Task<ComposedPayroll> ComposeAsync(Guid companyId, DateOnly periodStart, DateOnly periodEnd)
    {
        var employees = (await _db.Employees.AsNoTracking()
                .Where(e => e.CompanyId == companyId && e.IsActive)
                .OrderBy(e => e.Name)
                .ToListAsync())
            .Where(e => e.IsEmployedDuring(periodStart, periodEnd))
            .ToList();
        var employeeIds = employees.Select(e => e.Id).ToList();

        var contracts = (await _db.EmployeeContracts.AsNoTracking()
                .Where(c => employeeIds.Contains(c.EmployeeId) && c.StartDate <= periodEnd && (c.EndDate == null || c.EndDate >= periodStart))
                .ToListAsync())
            .GroupBy(c => c.EmployeeId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.StartDate).First());

        var departments = await _db.Departments.AsNoTracking()
            .Where(d => d.CompanyId == companyId)
            .ToDictionaryAsync(d => d.Id);

        // An adjustment dated to a month belongs to any run that touches that month.
        var firstMonth = new DateOnly(periodStart.Year, periodStart.Month, 1);
        var adjustments = await _db.PayrollAdjustments
            .Where(a => a.CompanyId == companyId && a.PayrollRunId == null && a.Period >= firstMonth && a.Period <= periodEnd &&
                a.Kind != PayrollAdjustmentKind.LoanRepayment)
            .ToListAsync();

        // G10: one installment per active loan, generated fresh for every compose (a released
        // Draft deletes its generated repayments, so they are never left over to double up).
        var repayments = await _loans.RepaymentsForAsync(companyId, employeeIds, periodStart, periodEnd);
        _db.PayrollAdjustments.AddRange(repayments);
        adjustments.AddRange(repayments);

        var leaveTypes = await _db.LeaveTypes.AsNoTracking()
            .Where(t => t.CompanyId == companyId)
            .ToDictionaryAsync(t => t.Id);
        var leave = await _db.LeaveRequests.AsNoTracking()
            .Where(r => r.CompanyId == companyId && r.State == LeaveRequestState.Approved &&
                r.StartDate <= periodEnd && r.EndDate >= periodStart)
            .ToListAsync();

        var holidays = (await _db.PublicHolidays.AsNoTracking()
                .Where(h => h.CompanyId == companyId && h.Date >= periodStart && h.Date <= periodEnd)
                .Select(h => h.Date)
                .ToListAsync())
            .ToHashSet();

        // Values in force at the end of the period (a mid-month minimum-wage change applies to it).
        var parameters = await _parameters.ForCompanyAsync(companyId, periodEnd);
        var builder = new PayslipBuilder(_calculation, parameters.ToRates());
        var lines = new List<PayslipLine>();
        var consumed = new List<PayrollAdjustment>();
        var warnings = new List<string>();
        var minimumWage = parameters.MinimumWage > 0m ? parameters.MinimumWage : (decimal?)null;

        foreach (var employee in employees)
        {
            var contract = contracts.GetValueOrDefault(employee.Id);
            var employeeAdjustments = adjustments.Where(a => a.EmployeeId == employee.Id).ToList();
            var employeeLeave = leave
                .Where(r => r.EmployeeId == employee.Id && leaveTypes.ContainsKey(r.LeaveTypeId))
                .Select(r => (r, leaveTypes[r.LeaveTypeId]))
                .ToList();
            var department = employee.DepartmentId is { } d ? departments.GetValueOrDefault(d) : null;

            lines.Add(builder.Build(new PayslipEmployeeData(employee, contract, department, employeeAdjustments, employeeLeave),
                periodStart, periodEnd, holidays));
            consumed.AddRange(employeeAdjustments);

            var monthlySalary = contract?.MonthlyGrossSalary ?? employee.MonthlyGrossSalary;
            if (minimumWage is { } min && monthlySalary < min && contract?.EmploymentType != EmploymentType.PartTime)
            {
                warnings.Add($"BelowMinimumWage:{employee.Name}");
            }

            if (employee.PersonalNumber is null)
            {
                warnings.Add($"MissingPersonalNumber:{employee.Name}");
            }
        }

        foreach (var orphan in adjustments.Where(a => !employeeIds.Contains(a.EmployeeId)))
        {
            warnings.Add($"AdjustmentNotIncluded:{orphan.Id}");
        }

        return new ComposedPayroll(lines, consumed, warnings, parameters);
    }
}
