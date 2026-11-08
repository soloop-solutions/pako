namespace Pako.Domain.Reporting;

public static class PeriodGranularity
{
    public const string Day = "day";
    public const string Week = "week";
    public const string Month = "month";
    public const string Quarter = "quarter";

    public const int MaxPoints = 120;

    public static readonly string[] All = [Day, Week, Month, Quarter];

    private static readonly Dictionary<string, (int MinDays, int StepDays)> Table = new()
    {
        [Day] = (1, 1),
        [Week] = (8, 7),
        [Month] = (32, 28),
        [Quarter] = (93, 90),
    };

    public static bool IsAllowed(string granularity, int days) =>
        Table.TryGetValue(granularity, out var rule) && days >= rule.MinDays && days / rule.StepDays <= MaxPoints;

    public static string Resolve(int days, string? requested)
    {
        if (requested is not null && IsAllowed(requested, days))
        {
            return requested;
        }

        return days <= 31 ? Day : days <= 120 ? Week : days <= 731 ? Month : Quarter;
    }

    public static IReadOnlyList<string> AllowedFor(int days) => All.Where(g => IsAllowed(g, days)).ToList();
}
