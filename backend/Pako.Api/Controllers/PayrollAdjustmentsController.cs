using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Authorization;
using Pako.Api.Contracts;
using Pako.Api.Services;
using Pako.Domain.Hr;
using Pako.Domain.Payroll;
using Pako.Infrastructure;
using Pako.Localization.Xk;

namespace Pako.Api.Controllers;

// Bonuses, commissions, allowances, overtime/premium hours and after-tax deductions for a month.
// The next payroll run touching that month picks them up; once a run has consumed one it can
// only change by recomputing or deleting that (Draft) run, and never after posting.
[ApiController]
[Route("api/companies/{companyId:guid}/payroll-adjustments")]
[Authorize]
public class PayrollAdjustmentsController : ControllerBase
{
    private readonly PakoDbContext _db;
    private readonly IStringLocalizer<ErrorMessages> _localizer;

    public PayrollAdjustmentsController(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
    {
        _db = db;
        _localizer = localizer;
    }

    // Unpaged: scoped to one month (or one employee), which bounds it to a screenful.
    [HttpGet(Name = "ListPayrollAdjustments")]
    [RequireCompanyAccess(module: AccessModule.Payroll)]
    public async Task<ActionResult<List<PayrollAdjustmentResponse>>> List(
        Guid companyId, [FromQuery] DateOnly? period = null, [FromQuery] Guid? employeeId = null)
    {
        var query = _db.PayrollAdjustments.AsNoTracking().Where(a => a.CompanyId == companyId);
        if (period is { } p) query = query.Where(a => a.Period == FirstOfMonth(p));
        if (employeeId is { } e) query = query.Where(a => a.EmployeeId == e);

        var adjustments = await query.OrderBy(a => a.Period).ThenBy(a => a.CreatedAt).ToListAsync();
        var names = await EmployeeNamesAsync(companyId);
        return Ok(adjustments.Select(a => ToResponse(a, names.GetValueOrDefault(a.EmployeeId, string.Empty))).ToList());
    }

    [HttpPost(Name = "CreatePayrollAdjustment")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Payroll)]
    [ProducesResponseType(typeof(PayrollAdjustmentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<PayrollAdjustmentResponse>> Create(Guid companyId, SavePayrollAdjustmentRequest request)
    {
        var adjustment = new PayrollAdjustment { Id = Guid.NewGuid(), CompanyId = companyId };
        var error = await ApplyAsync(companyId, adjustment, request);
        if (error is not null) return error;

        _db.PayrollAdjustments.Add(adjustment);
        await _db.SaveChangesAsync();

        var names = await EmployeeNamesAsync(companyId);
        return StatusCode(StatusCodes.Status201Created, ToResponse(adjustment, names.GetValueOrDefault(adjustment.EmployeeId, string.Empty)));
    }

    [HttpPut("{id:guid}", Name = "UpdatePayrollAdjustment")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Payroll)]
    public async Task<ActionResult<PayrollAdjustmentResponse>> Update(Guid companyId, Guid id, SavePayrollAdjustmentRequest request)
    {
        var adjustment = await _db.PayrollAdjustments.FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (adjustment is null) return NotFound();
        if (adjustment.PayrollRunId is not null) return BadRequest(_localizer["AdjustmentConsumed"].Value);

        var error = await ApplyAsync(companyId, adjustment, request);
        if (error is not null) return error;

        await _db.SaveChangesAsync();
        var names = await EmployeeNamesAsync(companyId);
        return Ok(ToResponse(adjustment, names.GetValueOrDefault(adjustment.EmployeeId, string.Empty)));
    }

    [HttpDelete("{id:guid}", Name = "DeletePayrollAdjustment")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Payroll)]
    public async Task<IActionResult> Delete(Guid companyId, Guid id)
    {
        var adjustment = await _db.PayrollAdjustments.FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (adjustment is null) return NotFound();
        if (adjustment.PayrollRunId is not null) return BadRequest(_localizer["AdjustmentConsumed"].Value);

        _db.PayrollAdjustments.Remove(adjustment);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // G11: (re)creates this month's commission adjustments from each employee's plan. HR reviews and
    // edits them like any other adjustment before the run is created.
    [HttpPost("calculate-commissions", Name = "CalculateCommissions")]
    [RequireCompanyAccess(writeAccess: true, module: AccessModule.Payroll)]
    public async Task<ActionResult<List<CommissionResultResponse>>> CalculateCommissions(
        Guid companyId, CalculateCommissionsRequest request, [FromServices] CommissionService commissions) =>
        Ok(await commissions.CalculateAsync(companyId, request.Period));

    // The documents behind a computed commission (drill-down).
    [HttpGet("{id:guid}/commission-basis", Name = "GetCommissionBasis")]
    [RequireCompanyAccess(module: AccessModule.Payroll)]
    public async Task<ActionResult<List<CommissionBasisItemResponse>>> CommissionBasis(
        Guid companyId, Guid id, [FromServices] CommissionService commissions)
    {
        var adjustment = await _db.PayrollAdjustments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id && a.CompanyId == companyId);
        if (adjustment?.CommissionPlanId is not { } planId) return NotFound();
        var plan = await _db.CommissionPlans.AsNoTracking().FirstAsync(p => p.Id == planId);
        return Ok(await commissions.BasisAsync(companyId, adjustment.EmployeeId, plan.Basis, adjustment.Period,
            adjustment.Period.AddMonths(1).AddDays(-1)));
    }

    // Hours × hourly rate (salary in force that month ÷ its weekly hours × 52/12) × premium
    // multiplier — the default for the kind unless one is given. Shared with timesheets (G12).
    internal static async Task<(decimal Amount, decimal Multiplier)> HourBasedAmountAsync(
        PakoDbContext db, Guid companyId, Employee employee, DateOnly period, PayrollAdjustmentKind kind, decimal hours, decimal? multiplier)
    {
        var monthEnd = period.AddMonths(1).AddDays(-1);
        var contract = await db.EmployeeContracts.AsNoTracking()
            .Where(c => c.EmployeeId == employee.Id && c.StartDate <= monthEnd && (c.EndDate == null || c.EndDate >= period))
            .OrderByDescending(c => c.StartDate)
            .FirstOrDefaultAsync();

        // Premiums and the standard week in force at the end of that month.
        var parameters = await new PayrollParameterProvider(db).ForCompanyAsync(companyId, monthEnd);
        var applied = multiplier is > 0m ? multiplier.Value : parameters.DefaultMultiplier(kind);
        var amount = PayrollAdjustment.AmountFromHours(
            contract?.MonthlyGrossSalary ?? employee.MonthlyGrossSalary,
            contract?.WeeklyHours ?? parameters.StandardWeeklyHours,
            hours,
            applied);
        return (amount, applied);
    }

    public static PayrollAdjustmentResponse ToResponse(PayrollAdjustment a, string employeeName) => new(
        a.Id, a.EmployeeId, employeeName, a.Period, a.Kind, a.Description, a.Hours, a.RateMultiplier, a.Amount, a.PayrollRunId,
        a.EmployeeLoanId, a.CommissionPlanId, a.CommissionBasisAmount);


    private async Task<ActionResult?> ApplyAsync(Guid companyId, PayrollAdjustment adjustment, SavePayrollAdjustmentRequest request)
    {
        // Loan repayments come from the loan (G10), never from a hand-typed adjustment.
        if (request.Kind == PayrollAdjustmentKind.LoanRepayment || adjustment.IsLoanRepayment)
        {
            return BadRequest(_localizer["LoanRepaymentIsAutomatic"].Value);
        }

        // Reimbursements are scheduled from the expense claim (H13); they can be deleted, not typed.
        if (request.Kind == PayrollAdjustmentKind.Reimbursement || adjustment.IsReimbursement)
        {
            return BadRequest(_localizer["ReimbursementFromClaimOnly"].Value);
        }

        var employee = await _db.Employees.AsNoTracking().FirstOrDefaultAsync(e => e.Id == request.EmployeeId && e.CompanyId == companyId);
        if (employee is null) return BadRequest(_localizer["EmployeeNotFound"].Value);

        var period = FirstOfMonth(request.Period);
        decimal amount;
        decimal? hours = null;
        decimal? multiplier = null;

        if (PayrollAdjustment.IsHourBased(request.Kind))
        {
            if (request.Hours is not > 0m) return BadRequest(_localizer["AdjustmentHoursRequired"].Value);

            hours = request.Hours;
            (amount, var applied) = await HourBasedAmountAsync(_db, companyId, employee, period, request.Kind, hours.Value, request.RateMultiplier);
            multiplier = applied;
        }
        else
        {
            if (request.Amount is not > 0m) return BadRequest(_localizer["AdjustmentAmountInvalid"].Value);
            amount = Math.Round(request.Amount.Value, 2, MidpointRounding.AwayFromZero);
        }

        adjustment.EmployeeId = employee.Id;
        adjustment.Period = period;
        adjustment.Kind = request.Kind;
        adjustment.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        adjustment.Hours = hours;
        adjustment.RateMultiplier = multiplier;
        adjustment.Amount = amount;
        return null;
    }

    private static DateOnly FirstOfMonth(DateOnly date) => new(date.Year, date.Month, 1);

    private Task<Dictionary<Guid, string>> EmployeeNamesAsync(Guid companyId) =>
        _db.Employees.AsNoTracking().Where(e => e.CompanyId == companyId).ToDictionaryAsync(e => e.Id, e => e.Name);
}
