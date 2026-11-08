using System.Globalization;
using System.Text;
using Pako.Domain.Reporting;

namespace Pako.Api.Services;

public record ChartSeries(string Name, string Color, IReadOnlyList<decimal> Values);

public static class DashboardChartSvg
{
    public const string Grid = "#E1E0D9";
    public const string Axis = "#C3C2B7";

    private static string F(double v) => v.ToString("0.##", CultureInfo.InvariantCulture);

    public static IReadOnlyList<decimal> TicksFor(IEnumerable<ChartSeries> series)
    {
        var all = series.SelectMany(s => s.Values).ToList();
        var min = Math.Min(0m, all.Count == 0 ? 0m : all.Min());
        var max = Math.Max(0m, all.Count == 0 ? 0m : all.Max());
        return ChartScale.NiceTicks(min, max);
    }

    public static string Plot(IReadOnlyList<ChartSeries> series, string kind, IReadOnlyList<decimal> ticks, double width, double height, IReadOnlyList<string>? barColors = null)
    {
        var tMin = (double)ticks[0];
        var tMax = (double)ticks[^1];
        var span = tMax - tMin == 0 ? 1 : tMax - tMin;
        double Y(decimal v) => height - (double)(((double)v - tMin) / span) * height;
        var n = Math.Max(1, series.Max(s => s.Values.Count));
        var slot = width / n;

        var sb = new StringBuilder();
        sb.Append($"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {F(width)} {F(height)}\" width=\"{F(width)}\" height=\"{F(height)}\">");
        foreach (var t in ticks)
        {
            var y = Y(t);
            var color = t == 0 ? Axis : Grid;
            var thickness = t == 0 ? 0.8 : 0.5;
            sb.Append($"<rect x=\"0\" y=\"{F(y - thickness / 2)}\" width=\"{F(width)}\" height=\"{F(thickness)}\" fill=\"{color}\"/>");
        }

        var zeroY = Y(0m);
        if (kind == "column")
        {
            var group = series.Count;
            var barWidth = Math.Min(slot * 0.7 / group, 22);
            var groupWidth = barWidth * group;
            for (var s = 0; s < group; s++)
            {
                for (var i = 0; i < series[s].Values.Count; i++)
                {
                    var v = series[s].Values[i];
                    var x = i * slot + (slot - groupWidth) / 2 + s * barWidth;
                    var y = Y(v);
                    var top = Math.Min(y, zeroY);
                    var h = Math.Abs(y - zeroY);
                    if (h < 0.4 && v != 0) h = 0.4;
                    var fill = barColors is not null && group == 1 ? barColors[i % barColors.Count] : series[s].Color;
                    sb.Append($"<rect x=\"{F(x)}\" y=\"{F(top)}\" width=\"{F(barWidth)}\" height=\"{F(h)}\" fill=\"{fill}\"/>");
                }
            }
        }
        else
        {
            for (var s = 0; s < series.Count; s++)
            {
                var pts = series[s].Values.Select((v, i) => (X: n == 1 ? width / 2 : i * (width - slot) / (n - 1) + slot / 2, Y: Y(v))).ToList();
                if (pts.Count == 0) continue;
                var path = string.Join(" ", pts.Select(p => $"{F(p.X)},{F(p.Y)}"));
                if (kind == "area" && s == 0 && pts.Count > 1)
                {
                    sb.Append($"<polygon points=\"{F(pts[0].X)},{F(zeroY)} {path} {F(pts[^1].X)},{F(zeroY)}\" fill=\"{series[s].Color}\" fill-opacity=\"0.16\"/>");
                }
                if (pts.Count == 1)
                {
                    sb.Append($"<circle cx=\"{F(pts[0].X)}\" cy=\"{F(pts[0].Y)}\" r=\"2.2\" fill=\"{series[s].Color}\"/>");
                }
                else
                {
                    sb.Append($"<polyline points=\"{path}\" fill=\"none\" stroke=\"{series[s].Color}\" stroke-width=\"1.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>");
                }
            }
        }

        sb.Append("</svg>");
        return sb.ToString();
    }

    public static string Sparkline(IReadOnlyList<decimal> values, string color, double width, double height)
    {
        var min = (double)values.Min();
        var max = (double)values.Max();
        var span = max - min == 0 ? 1 : max - min;
        var pad = 2d;
        var pts = values.Select((v, i) => $"{F(i * (width - 2 * pad) / (values.Count - 1) + pad)},{F(height - pad - ((double)v - min) / span * (height - 2 * pad))}");
        return $"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {F(width)} {F(height)}\" width=\"{F(width)}\" height=\"{F(height)}\">" +
               $"<polyline points=\"{string.Join(" ", pts)}\" fill=\"none\" stroke=\"{color}\" stroke-width=\"1.3\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/></svg>";
    }
}
