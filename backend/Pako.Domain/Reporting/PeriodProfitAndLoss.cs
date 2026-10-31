namespace Pako.Domain.Reporting;

public record PeriodPnlTotals(
    decimal TotalIncome, decimal TotalCostOfRevenue, decimal GrossProfit, decimal TotalOperatingExpenses = 0m);

public static class PeriodProfitAndLoss
{
    public static PeriodPnlTotals Calculate(IEnumerable<decimal> income, IEnumerable<decimal> costOfRevenue) =>
        Calculate(income, costOfRevenue, Array.Empty<decimal>());

    public static PeriodPnlTotals Calculate(
        IEnumerable<decimal> income, IEnumerable<decimal> costOfRevenue, IEnumerable<decimal> operatingExpenses)
    {
        var totalIncome = income.Sum();
        var totalCost = costOfRevenue.Sum();
        return new PeriodPnlTotals(totalIncome, totalCost, totalIncome - totalCost, operatingExpenses.Sum());
    }
}
