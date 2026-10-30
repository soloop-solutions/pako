namespace Pako.Domain.Hr;

public static class LeaveCarryOver
{
    // Carried-over days are used first. Once the expiry date has passed, whatever part of them the
    // approved leave starting on or before that date did not use up has lapsed.
    public static decimal Expired(decimal carried, DateOnly? expiresOn, DateOnly asOf, IEnumerable<(DateOnly Start, decimal Days)> approved)
    {
        if (carried <= 0m || expiresOn is not { } expiry || asOf <= expiry) return 0m;

        var usedBeforeExpiry = approved.Where(a => a.Start <= expiry).Sum(a => a.Days);
        return Math.Max(0m, carried - usedBeforeExpiry);
    }
}
