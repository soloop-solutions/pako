using Pako.Domain.Ledger;
using Pako.Domain.Reporting;

namespace Pako.Tests;

public class ReportingDomainTests
{
    private static AccountMovement Move(CashFlowCategory category, decimal debit, decimal credit, string code = "1000") =>
        new(Guid.NewGuid(), code, "Account " + code, category, debit, credit);

    [Fact]
    public void CashFlow_ReceivableIncrease_ReducesOperatingCash()
    {
        var receivable = Move(CashFlowCategory.Operating, 500m, 0m, "1200");

        var result = CashFlowStatement.Calculate(1000m, [receivable], 200m, 700m);

        Assert.Single(result.Operating);
        Assert.Empty(result.Investing);
        Assert.Empty(result.Financing);
        Assert.Equal(500m, result.NetChange);
        Assert.Equal(700m, result.ClosingComputed);
        Assert.Equal(0m, result.Difference);
    }

    [Fact]
    public void CashFlow_FixedAssetPurchase_IsInvesting()
    {
        var asset = Move(CashFlowCategory.Investing, 3000m, 0m, "2100");

        var result = CashFlowStatement.Calculate(0m, [asset], 5000m, 2000m);

        Assert.Single(result.Investing);
        Assert.Empty(result.Operating);
        Assert.Equal(-3000m, result.NetChange);
        Assert.Equal(2000m, result.ClosingComputed);
        Assert.Equal(0m, result.Difference);
    }

    [Fact]
    public void CashFlow_LoanDrawdown_IsFinancing()
    {
        var loan = Move(CashFlowCategory.Financing, 0m, 10000m, "4100");

        var result = CashFlowStatement.Calculate(0m, [loan], 1000m, 11000m);

        Assert.Single(result.Financing);
        Assert.Equal(10000m, result.NetChange);
        Assert.Equal(11000m, result.ClosingComputed);
        Assert.Equal(0m, result.Difference);
    }

    [Fact]
    public void CashFlow_CategoryNone_IsExcluded()
    {
        var ignored = Move(CashFlowCategory.None, 0m, 999m, "9999");
        var counted = Move(CashFlowCategory.Operating, 0m, 100m, "4000");

        var result = CashFlowStatement.Calculate(50m, [ignored, counted], 0m, 150m);

        Assert.Single(result.Operating);
        Assert.Empty(result.Investing);
        Assert.Empty(result.Financing);
        Assert.Equal(150m, result.NetChange);
        Assert.Equal(0m, result.Difference);
    }

    [Fact]
    public void CashFlow_ClosesToActualCash_WhenBooksBalance()
    {
        var movements = new[]
        {
            Move(CashFlowCategory.Operating, 500m, 0m, "1200"),
            Move(CashFlowCategory.Operating, 0m, 300m, "4000"),
            Move(CashFlowCategory.Investing, 2000m, 0m, "2100"),
            Move(CashFlowCategory.Financing, 0m, 5000m, "4100"),
        };

        var result = CashFlowStatement.Calculate(1200m, movements, 1000m, 5000m);

        Assert.Equal(4000m, result.NetChange);
        Assert.Equal(5000m, result.ClosingComputed);
        Assert.Equal(0m, result.Difference);
    }

    [Fact]
    public void Equity_ClosingIsOpeningPlusProfitPlusMovements()
    {
        var closing = EquityStatement.Closing(10000m, 2500m, [1000m, -400m]);

        Assert.Equal(13100m, closing);
    }

    [Fact]
    public void Reconciler_PassesWithinOneCent_FailsBeyond()
    {
        var within = ReportReconciler.Equal("a", 100.00m, 100.01m);
        var beyond = ReportReconciler.Equal("b", 100.00m, 100.02m);

        Assert.True(within.Passed);
        Assert.Equal(new CheckResult("a", true, 100.00m, 100.01m), within);
        Assert.False(beyond.Passed);
        Assert.Equal("b", beyond.Key);
        Assert.Equal(100.02m, beyond.Actual);
    }

    [Fact]
    public void MonthlyPnl_Calculate_ProducesSectionMonthsAndYearTotals()
    {
        List<decimal> Months(params (int Month, decimal Amount)[] v) => MonthlyProfitAndLoss.Months(v);
        var income = new[] { Months((1, 1000m), (3, 2000m)) };
        var cost = new[] { Months((1, 300m), (12, 600m)) };
        var expenses = new[] { Months((3, 400m)) };

        var r = MonthlyProfitAndLoss.Calculate(income, cost, expenses);

        Assert.Equal(12, r.IncomeByMonth.Count);
        Assert.Equal(1000m, r.IncomeByMonth[0]);
        Assert.Equal(2000m, r.IncomeByMonth[2]);
        Assert.Equal(600m, r.CostOfRevenueByMonth[11]);
        Assert.Equal(400m, r.ExpensesByMonth[2]);
        Assert.Equal(3000m, r.TotalIncome);
        Assert.Equal(900m, r.TotalCostOfRevenue);
        Assert.Equal(400m, r.TotalExpenses);
        Assert.Equal(700m, r.GrossProfitByMonth[0]);
        Assert.Equal(-600m, r.GrossProfitByMonth[11]);
        Assert.Equal(1600m, r.NetIncomeByMonth[2]);
        Assert.Equal(2100m, r.GrossProfit);
        Assert.Equal(1700m, r.NetIncome);
    }

    [Fact]
    public void MonthlyPnl_Calculate_EmptySectionsGiveTwelveZeros()
    {
        var r = MonthlyProfitAndLoss.Calculate([], [], []);

        Assert.Equal(12, r.IncomeByMonth.Count);
        Assert.All(r.NetIncomeByMonth, v => Assert.Equal(0m, v));
        Assert.Equal(0m, r.NetIncome);
    }

    [Fact]
    public void Comparative_Totals_SumCurrentPriorAndDifference()
    {
        Assert.Equal(1700m, ComparativeStatement.Difference(2200m, 500m));

        var totals = ComparativeStatement.Totals([(2200m, 500m), (100m, 250m)]);

        Assert.Equal(2300m, totals.Current);
        Assert.Equal(750m, totals.Prior);
        Assert.Equal(1550m, totals.Difference);
    }

    [Fact]
    public void Comparative_Totals_EmptyIsZero()
    {
        var totals = ComparativeStatement.Totals([]);

        Assert.Equal(0m, totals.Current);
        Assert.Equal(0m, totals.Prior);
        Assert.Equal(0m, totals.Difference);
    }

    [Fact]
    public void EquityOpening_IsAssetsLessLiabilities()
    {
        var opening = EquityStatement.Opening([(500m, 0m), (300m, 100m)], [(0m, 150m), (20m, 0m)]);

        Assert.Equal(700m - 130m, opening);
    }

    [Fact]
    public void ExpenseBook_Totals_RowColumnAndGrand()
    {
        var rows = new[] { new[] { 1000m, 0m }, new[] { 50m, 240m } };

        Assert.Equal(1000m, ExpenseBookTotals.Row(rows[0]));
        Assert.Equal(290m, ExpenseBookTotals.Row(rows[1]));
        var columns = ExpenseBookTotals.Columns(rows, 2);
        Assert.Equal(new[] { 1050m, 240m }, columns);
        Assert.Equal(1290m, ExpenseBookTotals.Grand(columns));
    }

    [Fact]
    public void BalanceSheetEquation_WhenBalanced_HasZeroDifference()
    {
        var result = BalanceSheetTotals.Equation(2061.02m, 552.54m, 1508.48m);

        Assert.Equal(2061.02m, result.TotalLiabilitiesAndEquity);
        Assert.Equal(0m, result.Difference);
    }

    [Fact]
    public void BalanceSheetEquation_WhenUnbalanced_ReportsExactSignedDifference()
    {
        var over = BalanceSheetTotals.Equation(1000.10m, 400.05m, 590.00m);
        var under = BalanceSheetTotals.Equation(900m, 400.05m, 590.00m);

        Assert.Equal(990.05m, over.TotalLiabilitiesAndEquity);
        Assert.Equal(10.05m, over.Difference);
        Assert.Equal(-90.05m, under.Difference);
    }
}
