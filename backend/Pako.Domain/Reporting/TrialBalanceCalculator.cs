namespace Pako.Domain.Reporting;

public record TrialBalanceAmounts(decimal Opening, decimal Debit, decimal Credit, decimal Balance, decimal Closing);

public record TrialBalanceGroup<T>(int? Class, string? GroupName, List<T> Lines, TrialBalanceAmounts Total);

public static class TrialBalanceCalculator
{
    public static List<TrialBalanceGroup<T>> Groups<T>(
        IEnumerable<T> lines, Func<T, int?> classOf, Func<T, string?> groupNameOf, Func<T, TrialBalanceAmounts> amountsOf)
    {
        var order = new List<(int? Class, string? GroupName)>();
        var buckets = new Dictionary<(int? Class, string? GroupName), List<T>>();
        foreach (var line in lines)
        {
            var key = (classOf(line), groupNameOf(line));
            if (!buckets.TryGetValue(key, out var bucket))
            {
                bucket = new List<T>();
                buckets[key] = bucket;
                order.Add(key);
            }

            bucket.Add(line);
        }

        return order
            .Select(k => new TrialBalanceGroup<T>(k.Class, k.GroupName, buckets[k], Total(buckets[k].Select(amountsOf))))
            .ToList();
    }

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
