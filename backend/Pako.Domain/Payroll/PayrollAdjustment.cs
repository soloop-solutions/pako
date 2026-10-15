namespace Pako.Domain.Payroll;

// One-off pay items for a month (ERPNext "Additional Salary"). Everything except Deduction is
// added to gross and so is taxed and pensioned; Deduction comes out of net after tax (advance
// recovery, court garnishment, damage).
public enum PayrollAdjustmentKind
{
    Bonus,
    Commission,
    Allowance,
    Overtime,
    NightWork,
    WeekendWork,
    HolidayWork,
    Deduction
}

public class PayrollAdjustment
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }

    // First day of the month the item is paid in. A run consumes every unconsumed adjustment
    // whose Period falls inside the run's period.
    public DateOnly Period { get; set; }
    public PayrollAdjustmentKind Kind { get; set; }
    public string? Description { get; set; }

    // Hour-based kinds (Overtime/NightWork/WeekendWork/HolidayWork) record the hours and the
    // multiplier applied to the hourly rate; Amount is computed from them when the item is saved.
    public decimal? Hours { get; set; }
    public decimal? RateMultiplier { get; set; }
    public decimal Amount { get; set; }

    public Guid? PayrollRunId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public bool IsDeduction => Kind == PayrollAdjustmentKind.Deduction;
    public bool IsBonus => Kind is PayrollAdjustmentKind.Bonus or PayrollAdjustmentKind.Commission;

    public static bool IsHourBased(PayrollAdjustmentKind kind) => kind is
        PayrollAdjustmentKind.Overtime or PayrollAdjustmentKind.NightWork or
        PayrollAdjustmentKind.WeekendWork or PayrollAdjustmentKind.HolidayWork;

    // Hourly rate = monthly base / (weekly hours × 52 / 12).
    public static decimal HourlyRate(decimal monthlyGross, decimal weeklyHours) =>
        weeklyHours <= 0m ? 0m : monthlyGross / (weeklyHours * 52m / 12m);

    public static decimal AmountFromHours(decimal monthlyGross, decimal weeklyHours, decimal hours, decimal multiplier) =>
        Math.Round(HourlyRate(monthlyGross, weeklyHours) * hours * multiplier, 2, MidpointRounding.AwayFromZero);
}
