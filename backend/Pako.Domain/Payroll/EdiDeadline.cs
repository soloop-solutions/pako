namespace Pako.Domain.Payroll;

// I14: when the monthly EDI wage & pension declaration for a payroll month is due — the 15th of
// the following month, moved to the next working day when the 15th is a weekend or a public
// holiday (to confirm with the partner accounting firm; see docs/HR_MASTER_PLAN.md I14).
public static class EdiDeadline
{
    public const int DueDay = 15;

    public static DateOnly DueDate(DateOnly anyDayInPayrollMonth, IReadOnlySet<DateOnly> holidays)
    {
        var next = new DateOnly(anyDayInPayrollMonth.Year, anyDayInPayrollMonth.Month, 1).AddMonths(1);
        var due = new DateOnly(next.Year, next.Month, DueDay);
        while (due.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday || holidays.Contains(due))
        {
            due = due.AddDays(1);
        }

        return due;
    }
}
