namespace Pako.Domain.Reporting;

public record TrialBalanceAmounts(decimal Opening, decimal Debit, decimal Credit, decimal Balance, decimal Closing);

public static class TrialBalanceCalculator
{
    public static TrialBalanceAmounts Line(decimal openingDebit, decimal openingCredit, decimal periodDebit, decimal periodCredit)
    {
        var opening = openingDebit - openingCredit;
        var balance = periodDebit - periodCredit;
        return new TrialBalanceAmounts(opening, periodDebit, periodCredit, balance, opening + balance);
    }

    public static TrialBalanceAmounts Total(IEnumerable<TrialBalanceAmounts> lines)
    {
        var all = lines.ToList();
        return new TrialBalanceAmounts(
            all.Sum(l => l.Opening), all.Sum(l => l.Debit), all.Sum(l => l.Credit), all.Sum(l => l.Balance), all.Sum(l => l.Closing));
    }
}
