using Pako.Api.Services;
using Pako.Domain.Reporting;

namespace Pako.Tests;

public class DashboardMathTests
{
    [Theory]
    [InlineData(28, "day,week")]
    [InlineData(31, "day,week")]
    [InlineData(91, "day,week,month")]
    [InlineData(92, "day,week,month")]
    [InlineData(93, "day,week,month,quarter")]
    [InlineData(365, "week,month,quarter")]
    [InlineData(7, "day")]
    [InlineData(1, "day")]
    public void AllowedGranularities_AreFinerThanThePeriod(int days, string expected)
    {
        Assert.Equal(expected.Split(','), PeriodGranularity.AllowedFor(days));
    }

    [Theory]
    [InlineData("2026-10-01", "2026-10-31", "month", "day")]
    [InlineData("2026-10-01", "2026-10-31", "quarter", "day")]
    [InlineData("2026-07-01", "2026-09-30", "quarter", "week")]
    [InlineData("2026-01-01", "2026-12-31", "quarter", "quarter")]
    [InlineData("2026-10-01", "2026-10-31", "week", "week")]
    public void CoarserThanThePeriodFallsBackToAutomatic(string from, string to, string requested, string expected)
    {
        Assert.Equal(expected, DashboardService.ResolveGranularity(DateOnly.Parse(from), DateOnly.Parse(to), requested));
    }

    [Fact]
    public void PercentChange_HandlesZeroPreviousAndNegativeBase()
    {
        Assert.Null(ChangeMath.PercentChange(100m, 0m));
        Assert.Null(ChangeMath.PercentChange(100m, null));
        Assert.Equal(100m, ChangeMath.PercentChange(200m, 100m));
        Assert.Equal(-50m, ChangeMath.PercentChange(50m, 100m));
        Assert.Equal(50m, ChangeMath.PercentChange(-50m, -100m));
        Assert.Equal(200m, ChangeMath.PercentChange(100m, -100m));
    }

    [Fact]
    public void NiceTicks_CoverTheRangeIncludingNegativesAndFlatData()
    {
        Assert.Equal([0m, 5000m, 10000m, 15000m, 20000m], ChartScale.NiceTicks(0m, 16000m));
        Assert.Equal([-5000m, 0m, 5000m, 10000m, 15000m, 20000m], ChartScale.NiceTicks(-3000m, 16000m));
        Assert.Equal([0m, 1m], ChartScale.NiceTicks(0m, 0m));
        var flat = ChartScale.NiceTicks(500m, 500m);
        Assert.True(flat[0] <= 0m && flat[^1] >= 500m);
    }

    [Fact]
    public void MarginChange_IsInPercentagePoints()
    {
        Assert.Equal(10m, ChangeMath.PointChange(60m, 50m));
        Assert.Equal(-12.5m, ChangeMath.PointChange(-2.5m, 10m));
        Assert.Null(ChangeMath.PointChange(60m, null));
        Assert.Equal(0m, ChangeMath.MarginPercent(0m, 50m));
        Assert.Equal(60m, ChangeMath.MarginPercent(847.46m, 508.48m));
    }
}
