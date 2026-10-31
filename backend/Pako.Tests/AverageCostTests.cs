using Pako.Domain.Inventory;

namespace Pako.Tests;

// docs/INVENTORY_PLAN.md §5.2: weighted average cost, pure arithmetic.
public class AverageCostTests
{
    private static CostPosition P(decimal qty, decimal value, decimal avg) => new(qty, value, avg);

    [Fact]
    public void Receipts_AverageTheCost()
    {
        var r1 = AverageCost.Receive(CostPosition.Empty, 10, 100m);
        Assert.Equal(P(10, 100m, 10m), r1.After);
        var r2 = AverageCost.Receive(r1.After, 10, 140m);
        Assert.Equal(P(20, 240m, 12m), r2.After);
        Assert.Equal(0m, r2.Correction);
    }

    [Fact]
    public void Issues_LeaveAtTheAverage_AndDoNotChangeIt()
    {
        var issue = AverageCost.Issue(P(20, 240m, 12m), 5);
        Assert.Equal(60m, issue.MoveValue);
        Assert.Equal(P(15, 180m, 12m), issue.After);
        Assert.Equal(0m, issue.Correction);
    }

    [Fact]
    public void TheIssueThatEmptiesStock_TakesTheExactRemainingValue_SoRoundingNeverAccumulates()
    {
        // 3 units for 10.00 → average 3.333333
        var stock = AverageCost.Receive(CostPosition.Empty, 3, 10m).After;
        var first = AverageCost.Issue(stock, 1);
        Assert.Equal(3.33m, first.MoveValue);
        var second = AverageCost.Issue(first.After, 1);
        Assert.Equal(3.33m, second.MoveValue);
        var last = AverageCost.Issue(second.After, 1);
        Assert.Equal(3.34m, last.MoveValue);
        Assert.Equal(0m, last.After.Quantity);
        Assert.Equal(0m, last.After.Value);
    }

    [Fact]
    public void AReceiptAfterEmptyStock_RestartsAtTheIncomingCost()
    {
        var empty = P(0, 0m, 12m);
        var receipt = AverageCost.Receive(empty, 4, 50m);
        Assert.Equal(P(4, 50m, 12.5m), receipt.After);
    }

    [Fact]
    public void SellingBelowZero_ThenReceiving_CorrectsCostOfGoodsSold()
    {
        // 2 in stock at 10; sell 4 (Warn): 2 leave at their value, 2 more at the last average.
        var stock = P(2, 20m, 10m);
        var sale = AverageCost.Issue(stock, 4);
        Assert.Equal(40m, sale.MoveValue);
        Assert.Equal(P(-2, -20m, 10m), sale.After);

        // 5 arrive at 12: the 2 sold below zero really cost 12, not 10 → 4.00 more cost of goods sold.
        var receipt = AverageCost.Receive(sale.After, 5, 60m);
        Assert.Equal(P(3, 36m, 12m), receipt.After);
        Assert.Equal(4m, receipt.Correction);
    }

    [Fact]
    public void ASupplierCreditNote_LowersTheCostOfWhatIsStillInStock()
    {
        var revalue = AverageCost.Revalue(P(10, 120m, 12m), -20m);
        Assert.Equal(P(10, 100m, 10m), revalue.After);
        Assert.Equal(0m, revalue.Correction);
    }

    [Fact]
    public void ASupplierCreditNote_ForGoodsAlreadySold_GoesToCostOfGoodsSold()
    {
        var revalue = AverageCost.Revalue(P(0, 0m, 12m), -20m);
        Assert.Equal(P(0, 0m, 12m), revalue.After);
        // Negative correction = Dr Inventory / Cr COGS: the stock posting is reversed into COGS.
        Assert.Equal(-20m, revalue.Correction);
    }

    [Fact]
    public void ACreditBiggerThanTheStockValue_NeverMakesStockValueNegative()
    {
        var revalue = AverageCost.Revalue(P(1, 5m, 5m), -8m);
        Assert.Equal(P(1, 5m, 5m), revalue.After);
        Assert.Equal(-8m, revalue.Correction);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void ReceiptsAndIssues_NeedAPositiveQuantity(decimal quantity)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => AverageCost.Receive(CostPosition.Empty, quantity, 10m));
        Assert.Throws<ArgumentOutOfRangeException>(() => AverageCost.Issue(P(5, 50m, 10m), quantity));
    }

    [Fact]
    public void ALongRandomRun_KeepsValueEqualToQuantityTimesCostWithinACentPerUnit_AndZeroAtZero()
    {
        var random = new Random(42);
        var position = CostPosition.Empty;
        for (var i = 0; i < 2000; i++)
        {
            if (position.Quantity <= 0 || random.NextDouble() < 0.5)
            {
                var qty = random.Next(1, 50);
                var unit = Math.Round((decimal)(random.NextDouble() * 20 + 1), 2);
                position = AverageCost.Receive(position, qty, qty * unit).After;
            }
            else
            {
                var qty = Math.Min(position.Quantity, random.Next(1, 40));
                position = AverageCost.Issue(position, qty).After;
            }

            if (position.Quantity == 0) Assert.Equal(0m, position.Value);
            Assert.True(Math.Abs(position.Value - position.Quantity * position.AverageCost) <= 0.01m * Math.Max(1, position.Quantity),
                $"Drift at step {i}: {position}");
        }
    }
}
