using Pako.Domain.Inventory;
using Pako.Domain.Tax;

namespace Pako.Domain.Reporting;

public record StockMovementInput(StockMoveKind Kind, decimal Quantity, decimal ValueDelta);

public record StockMovementFigures(
    decimal OpeningQuantity, decimal OpeningValue, decimal InQuantity, decimal InValue,
    decimal OutQuantity, decimal OutValue, decimal ClosingQuantity, decimal ClosingValue);

public record StockMovementTotals(decimal OpeningValue, decimal InValue, decimal OutValue, decimal ClosingValue);

public static class StockMovementsCalculator
{
    public static StockMovementFigures Calculate(decimal openingQuantity, decimal openingValue, IEnumerable<StockMovementInput> moves)
    {
        decimal inQuantity = 0m, inValue = 0m, outQuantity = 0m, outValue = 0m;
        foreach (var move in moves)
        {
            switch (move.Kind)
            {
                case StockMoveKind.Receipt:
                    inQuantity += move.Quantity;
                    inValue += move.ValueDelta;
                    break;
                case StockMoveKind.Issue:
                    outQuantity += move.Quantity;
                    outValue -= move.ValueDelta;
                    break;
                case StockMoveKind.Revaluation:
                    if (move.ValueDelta >= 0m) inValue += move.ValueDelta;
                    else outValue -= move.ValueDelta;
                    break;
            }
        }

        return new StockMovementFigures(openingQuantity, openingValue, inQuantity, inValue, outQuantity, outValue,
            openingQuantity + inQuantity - outQuantity, openingValue + inValue - outValue);
    }

    public static decimal UnitCost(decimal value, decimal quantity) =>
        quantity == 0m ? 0m : AverageCost.UnitCost(value / quantity);

    public static decimal? NetSellPrice(decimal? grossPrice, TaxDefinition? tax, ITaxComputationService taxComputation)
    {
        if (grossPrice is not { } price) return null;
        return tax is null ? price : taxComputation.ComputeFromGross(price, tax).NetAmount;
    }

    public static decimal? MarkupPercent(decimal? sellPriceExVat, decimal averageCost)
    {
        if (sellPriceExVat is not { } sell || averageCost == 0m) return null;
        return Math.Round((sell - averageCost) / averageCost * 100m, 2, MidpointRounding.AwayFromZero);
    }

    public static StockMovementTotals Totals(IEnumerable<(decimal OpeningValue, decimal InValue, decimal OutValue, decimal ClosingValue)> rows)
    {
        var list = rows.ToList();
        return new StockMovementTotals(list.Sum(r => r.OpeningValue), list.Sum(r => r.InValue), list.Sum(r => r.OutValue), list.Sum(r => r.ClosingValue));
    }
}
