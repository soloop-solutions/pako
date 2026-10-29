namespace Pako.Domain.Reporting;

public static class EquityStatement
{
    public static decimal Closing(decimal opening, decimal netIncome, IEnumerable<decimal> movements) =>
        opening + netIncome + movements.Sum();
}
