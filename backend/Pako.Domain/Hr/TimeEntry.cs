namespace Pako.Domain.Hr;

public enum TimeEntryKind
{
    Regular,
    Overtime,
    Night,
    Weekend,
    Holiday
}

public enum TimeEntrySource
{
    Manual,
    Import
}

// G12: hours worked on one day. Regular hours are informational (the base salary already pays
// them); approving a month turns the premium kinds into the hour-based payroll adjustments HR
// otherwise types by hand.
public class TimeEntry
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public DateOnly Date { get; set; }
    public decimal Hours { get; set; }
    public TimeEntryKind Kind { get; set; }
    public TimeEntrySource Source { get; set; } = TimeEntrySource.Manual;
    public string? Note { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public bool IsApproved => ApprovedAt is not null;

    // When the kind isn't given: a public holiday, else a weekend, else regular. Overtime and night
    // work can't be told from the date and must be stated.
    public static TimeEntryKind KindFor(DateOnly date, IReadOnlySet<DateOnly> holidays) =>
        holidays.Contains(date) ? TimeEntryKind.Holiday
        : date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday ? TimeEntryKind.Weekend
        : TimeEntryKind.Regular;

    // The payroll adjustment a premium kind feeds; Regular feeds none.
    public static Pako.Domain.Payroll.PayrollAdjustmentKind? AdjustmentKindFor(TimeEntryKind kind) => kind switch
    {
        TimeEntryKind.Overtime => Pako.Domain.Payroll.PayrollAdjustmentKind.Overtime,
        TimeEntryKind.Night => Pako.Domain.Payroll.PayrollAdjustmentKind.NightWork,
        TimeEntryKind.Weekend => Pako.Domain.Payroll.PayrollAdjustmentKind.WeekendWork,
        TimeEntryKind.Holiday => Pako.Domain.Payroll.PayrollAdjustmentKind.HolidayWork,
        _ => null
    };
}
