namespace Pako.Domain.Hr;

public enum EmploymentType
{
    FullTime,
    PartTime,
    FixedTerm
}

// Dated salary history. The contract in force on a payroll period's end date supplies the base
// salary; with no contract, Employee.MonthlyGrossSalary is used (every employee created before
// contracts existed).
public class EmployeeContract
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid EmployeeId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public decimal MonthlyGrossSalary { get; set; }
    public EmploymentType EmploymentType { get; set; } = EmploymentType.FullTime;
    public decimal WeeklyHours { get; set; } = 40m;

    // Last day of the probation period (puna provuese), if any; drives the E8 reminder.
    public DateOnly? ProbationEndDate { get; set; }
    public string? JobTitle { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public bool CoversDate(DateOnly date) => StartDate <= date && (EndDate is null || EndDate >= date);

    public bool Overlaps(DateOnly start, DateOnly? end) =>
        StartDate <= (end ?? DateOnly.MaxValue) && (EndDate ?? DateOnly.MaxValue) >= start;
}
