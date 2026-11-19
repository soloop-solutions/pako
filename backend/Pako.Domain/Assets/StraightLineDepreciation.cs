namespace Pako.Domain.Assets;

public sealed record DepreciationScheduleLine(DateOnly Period, decimal Amount, decimal Accumulated, decimal BookValue);

// Straight-line depreciation, monthly. Depreciation starts the month after the asset is put in
// service and runs for UsefulLifeMonths months. Each month's amount is the difference between what
// should be depreciated by the end of that month (cost − residual) × months ÷ life, rounded to
// cents, and what already is: rounding never accumulates, the last month takes whatever is left,
// and the total never passes the depreciable base. A month that was skipped is caught up by the
// next run rather than lost.
public static class StraightLineDepreciation
{
    public static DateOnly MonthOf(DateOnly date) => new(date.Year, date.Month, 1);

    public static DateOnly FirstPeriod(DateOnly inServiceDate) => MonthOf(inServiceDate).AddMonths(1);

    public static decimal DepreciableBase(decimal cost, decimal residualValue) => Math.Max(0m, cost - residualValue);

    // Accumulated depreciation due by the end of `period` (any day of the month).
    public static decimal DueThrough(decimal cost, decimal residualValue, int usefulLifeMonths, DateOnly inServiceDate, DateOnly period)
    {
        var depreciable = DepreciableBase(cost, residualValue);
        if (depreciable == 0m || usefulLifeMonths <= 0) return 0m;
        var first = FirstPeriod(inServiceDate);
        var month = MonthOf(period);
        var months = (month.Year - first.Year) * 12 + month.Month - first.Month + 1;
        if (months <= 0) return 0m;
        if (months >= usefulLifeMonths) return depreciable;
        return Math.Round(depreciable * months / usefulLifeMonths, 2, MidpointRounding.AwayFromZero);
    }

    // The amount for `period` given what is already accumulated (opening + posted runs).
    public static decimal AmountFor(decimal cost, decimal residualValue, int usefulLifeMonths, DateOnly inServiceDate, DateOnly period, decimal alreadyAccumulated) =>
        Math.Max(0m, DueThrough(cost, residualValue, usefulLifeMonths, inServiceDate, period) - alreadyAccumulated);

    // The whole plan from the first month to the last, starting from an opening accumulated amount.
    public static IReadOnlyList<DepreciationScheduleLine> Schedule(decimal cost, decimal residualValue, int usefulLifeMonths, DateOnly inServiceDate, decimal openingAccumulated = 0m)
    {
        var lines = new List<DepreciationScheduleLine>();
        var depreciable = DepreciableBase(cost, residualValue);
        if (depreciable == 0m || usefulLifeMonths <= 0) return lines;
        var accumulated = openingAccumulated;
        var period = FirstPeriod(inServiceDate);
        for (var i = 0; i < usefulLifeMonths && accumulated < depreciable; i++, period = period.AddMonths(1))
        {
            var amount = AmountFor(cost, residualValue, usefulLifeMonths, inServiceDate, period, accumulated);
            if (amount == 0m) continue;
            accumulated += amount;
            lines.Add(new DepreciationScheduleLine(period, amount, accumulated, cost - accumulated));
        }

        return lines;
    }

    // The nominal monthly amount (individual months can differ by a cent).
    public static decimal MonthlyAmount(decimal cost, decimal residualValue, int usefulLifeMonths) =>
        usefulLifeMonths <= 0 ? 0m : Math.Round(DepreciableBase(cost, residualValue) / usefulLifeMonths, 2, MidpointRounding.AwayFromZero);

    public static decimal Accumulated(decimal openingAccumulated, IEnumerable<decimal> postedAmounts) => openingAccumulated + postedAmounts.Sum();

    public static decimal BookValue(decimal cost, decimal accumulated) => cost - accumulated;

    public static bool IsFullyDepreciated(decimal cost, decimal residualValue, decimal accumulated) =>
        accumulated >= DepreciableBase(cost, residualValue);

    // Disposal: the asset leaves the books at cost and accumulated depreciation; proceeds above the
    // book value are a gain, below it a loss.
    public static (decimal BookValue, decimal Gain, decimal Loss) Disposal(decimal cost, decimal accumulated, decimal proceeds)
    {
        var bookValue = cost - accumulated;
        var difference = proceeds - bookValue;
        return (bookValue, Math.Max(0m, difference), Math.Max(0m, -difference));
    }
}

public sealed record AssetYearAmounts(
    decimal CostOpening,
    decimal Additions,
    decimal CostDisposed,
    decimal CostClosing,
    decimal AccumulatedOpening,
    decimal Depreciation,
    decimal AccumulatedDisposed,
    decimal AccumulatedClosing,
    decimal BookValueOpening,
    decimal BookValueClosing)
{
    public static readonly AssetYearAmounts Zero = new(0m, 0m, 0m, 0m, 0m, 0m, 0m, 0m, 0m, 0m);

    public static AssetYearAmounts Sum(IEnumerable<AssetYearAmounts> amounts) => amounts.Aggregate(Zero, (a, b) => new AssetYearAmounts(
        a.CostOpening + b.CostOpening, a.Additions + b.Additions, a.CostDisposed + b.CostDisposed, a.CostClosing + b.CostClosing,
        a.AccumulatedOpening + b.AccumulatedOpening, a.Depreciation + b.Depreciation, a.AccumulatedDisposed + b.AccumulatedDisposed,
        a.AccumulatedClosing + b.AccumulatedClosing, a.BookValueOpening + b.BookValueOpening, a.BookValueClosing + b.BookValueClosing));
}

// The year-end depreciation schedule for one asset: cost and accumulated depreciation from the
// start of the year, plus the year's additions, depreciation and disposals, to the end of it.
// Depreciation taken before the company used Pako (the opening accumulated amount) counts in the
// opening balance for an asset bought before the year and as the year's depreciation for one
// bought during it. Null when the asset is not on the books at any time in the year.
public static class FixedAssetRollForward
{
    public static AssetYearAmounts? ForYear(
        int year, DateOnly acquisitionDate, DateOnly? disposedOn, decimal cost, decimal openingAccumulated,
        IEnumerable<(DateOnly Period, decimal Amount)> postedDepreciation)
    {
        var yearStart = new DateOnly(year, 1, 1);
        var yearEnd = new DateOnly(year, 12, 31);
        if (acquisitionDate > yearEnd || (disposedOn is { } gone && gone < yearStart)) return null;

        var posted = postedDepreciation.ToList();
        var boughtBefore = acquisitionDate < yearStart;
        var costOpening = boughtBefore ? cost : 0m;
        var additions = boughtBefore ? 0m : cost;
        var disposedInYear = disposedOn is { } d && d <= yearEnd;
        var costDisposed = disposedInYear ? cost : 0m;
        var costClosing = costOpening + additions - costDisposed;

        var postedBefore = posted.Where(p => p.Period < yearStart).Sum(p => p.Amount);
        var postedInYear = posted.Where(p => p.Period >= yearStart && p.Period <= yearEnd).Sum(p => p.Amount);
        var accumulatedOpening = postedBefore + (boughtBefore ? openingAccumulated : 0m);
        var depreciation = postedInYear + (boughtBefore ? 0m : openingAccumulated);
        var accumulatedDisposed = disposedInYear ? accumulatedOpening + depreciation : 0m;
        var accumulatedClosing = accumulatedOpening + depreciation - accumulatedDisposed;

        return new AssetYearAmounts(costOpening, additions, costDisposed, costClosing, accumulatedOpening, depreciation,
            accumulatedDisposed, accumulatedClosing, costOpening - accumulatedOpening, costClosing - accumulatedClosing);
    }
}
