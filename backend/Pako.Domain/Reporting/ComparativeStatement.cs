namespace Pako.Domain.Reporting;

public record SectionTotals(decimal Current, decimal Prior, decimal Difference);

public static class ComparativeStatement
{
    public static decimal Difference(decimal current, decimal prior) => current - prior;

    public static SectionTotals Totals(IEnumerable<(decimal Current, decimal Prior)> lines)
    {
        var list = lines.ToList();
        var current = list.Sum(l => l.Current);
        var prior = list.Sum(l => l.Prior);
        return new SectionTotals(current, prior, Difference(current, prior));
    }
}
