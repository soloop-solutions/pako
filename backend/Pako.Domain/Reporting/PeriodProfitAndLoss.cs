namespace Pako.Domain.Reporting;

public record PeriodPnlTotals(decimal TotalIncome, decimal TotalCostOfRevenue, decimal GrossProfit);

public static class PeriodProfitAndLoss
{
    public static PeriodPnlTotals Calculate(IEnumerable<decimal> income, IEnumerable<decimal> costOfRevenue)
    {
        var totalIncome = income.Sum();
        var totalCost = costOfRevenue.Sum();
        return new PeriodPnlTotals(totalIncome, totalCost, totalIncome - totalCost);
    }
}
