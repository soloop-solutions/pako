namespace Pako.Domain.Hr;

public static class WorkingDays
{
    // Mon–Fri, inclusive of both ends, minus any date in holidays.
    public static int Count(DateOnly from, DateOnly to, IReadOnlySet<DateOnly> holidays)
    {
        var count = 0;
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            if (IsWorkingDay(d, holidays))
            {
                count++;
            }
        }

        return count;
    }

    public static bool IsWorkingDay(DateOnly date, IReadOnlySet<DateOnly> holidays) =>
        date.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !holidays.Contains(date);

    public static DateOnly Max(DateOnly a, DateOnly b) => a > b ? a : b;
    public static DateOnly Min(DateOnly a, DateOnly b) => a < b ? a : b;
}
