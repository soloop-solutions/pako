namespace Pako.Domain.Reporting;

public static class ChangeMath
{
    public const string PercentUnit = "percent";
    public const string PointsUnit = "points";

    public static decimal? PercentChange(decimal current, decimal? previous) =>
        previous is { } p && p != 0 ? Math.Round((current - p) / Math.Abs(p) * 100m, 1, MidpointRounding.AwayFromZero) : null;

    public static decimal? PointChange(decimal current, decimal? previous) =>
        previous is { } p ? Math.Round(current - p, 1, MidpointRounding.AwayFromZero) : null;

    public static decimal MarginPercent(decimal revenue, decimal profit) =>
        revenue == 0 ? 0 : Math.Round(profit / revenue * 100m, 1, MidpointRounding.AwayFromZero);
}
