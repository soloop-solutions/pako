namespace Pako.Domain.Reporting;

public static class ChartScale
{
    public static IReadOnlyList<decimal> NiceTicks(decimal min, decimal max, int count = 4)
    {
        if (min == max)
        {
            if (min == 0)
            {
                return [0m, 1m];
            }
            min = Math.Min(0m, min);
            max = Math.Max(0m, max);
        }

        var raw = (double)(max - min) / count;
        var magnitude = Math.Pow(10, Math.Floor(Math.Log10(raw)));
        var step = new[] { 1d, 2d, 2.5d, 5d, 10d }.Select(m => m * magnitude).FirstOrDefault(s => raw <= s * 1.0000001);
        if (step == 0)
        {
            step = 10 * magnitude;
        }
        var stepD = (decimal)step;
        var start = Math.Floor(min / stepD) * stepD;
        var end = Math.Ceiling(max / stepD) * stepD;
        var ticks = new List<decimal>();
        for (var v = start; v <= end + stepD / 2; v += stepD)
        {
            ticks.Add(v);
        }
        return ticks;
    }
}
