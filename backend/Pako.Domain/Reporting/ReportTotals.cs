namespace Pako.Domain.Reporting;

public record LedgerTotals(decimal Debit, decimal Credit);

public record NetVatGrossTotals(decimal Net, decimal Vat, decimal Gross);

public static class ReportTotals
{
    public static LedgerTotals Ledger(IEnumerable<(decimal Debit, decimal Credit)> lines)
    {
        var all = lines.ToList();
        return new LedgerTotals(all.Sum(l => l.Debit), all.Sum(l => l.Credit));
    }

    public static NetVatGrossTotals NetVatGross(IEnumerable<(decimal Net, decimal Vat, decimal Gross)> lines)
    {
        var all = lines.ToList();
        return new NetVatGrossTotals(all.Sum(l => l.Net), all.Sum(l => l.Vat), all.Sum(l => l.Gross));
    }
}
