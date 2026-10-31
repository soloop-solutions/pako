namespace Pako.Domain.Reporting;

public record MonthlyPnlResult(
    List<decimal> IncomeByMonth,
    List<decimal> CostOfRevenueByMonth,
    List<decimal> ExpensesByMonth,
    List<decimal> GrossProfitByMonth,
    List<decimal> NetIncomeByMonth,
    decimal TotalIncome,
    decimal TotalCostOfRevenue,
    decimal TotalExpenses,
    decimal GrossProfit,
    decimal NetIncome);

public static class MonthlyProfitAndLoss
{
    public static List<decimal> Months(IEnumerable<(int Month, decimal Amount)> amounts)
    {
        var list = amounts.ToList();
        return Enumerable.Range(1, 12).Select(m => list.Where(x => x.Month == m).Sum(x => x.Amount)).ToList();
    }

    public static MonthlyPnlResult Calculate(
        IEnumerable<IReadOnlyList<decimal>> income,
        IEnumerable<IReadOnlyList<decimal>> costOfRevenue,
        IEnumerable<IReadOnlyList<decimal>> expenses)
    {
        static List<decimal> ByMonth(IEnumerable<IReadOnlyList<decimal>> lines)
        {
            var all = lines.ToList();
            return Enumerable.Range(0, 12).Select(m => all.Sum(l => l[m])).ToList();
        }

        var incomeByMonth = ByMonth(income);
        var costByMonth = ByMonth(costOfRevenue);
        var expensesByMonth = ByMonth(expenses);
        var gross = Enumerable.Range(0, 12).Select(m => incomeByMonth[m] - costByMonth[m]).ToList();
        var net = Enumerable.Range(0, 12).Select(m => gross[m] - expensesByMonth[m]).ToList();

        return new MonthlyPnlResult(
            incomeByMonth, costByMonth, expensesByMonth, gross, net,
            incomeByMonth.Sum(), costByMonth.Sum(), expensesByMonth.Sum(), gross.Sum(), net.Sum());
    }
}
