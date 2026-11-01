namespace Pako.Domain.Reporting;

public static class ExpenseBookTotals
{
    public static decimal Row(IEnumerable<decimal> amounts) => amounts.Sum();

    public static List<decimal> Columns(IEnumerable<IReadOnlyList<decimal>> rows, int columnCount)
    {
        var all = rows.ToList();
        return Enumerable.Range(0, columnCount).Select(i => all.Sum(r => r[i])).ToList();
    }

    public static decimal Grand(IEnumerable<decimal> columnTotals) => columnTotals.Sum();
}
