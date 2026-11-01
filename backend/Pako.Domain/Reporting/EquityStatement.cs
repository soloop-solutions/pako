namespace Pako.Domain.Reporting;

public static class EquityStatement
{
    public static decimal Opening(
        IEnumerable<(decimal Debit, decimal Credit)> assets,
        IEnumerable<(decimal Debit, decimal Credit)> liabilities) =>
        assets.Sum(a => a.Debit - a.Credit) - liabilities.Sum(l => l.Credit - l.Debit);

    public static decimal Closing(decimal opening, decimal netIncome, IEnumerable<decimal> movements) =>
        opening + netIncome + movements.Sum();
}
