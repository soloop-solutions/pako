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
}
