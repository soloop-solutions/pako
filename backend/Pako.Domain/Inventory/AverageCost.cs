namespace Pako.Domain.Inventory;

// An item's company-wide stock position: quantity, value (2 decimals) and average unit cost
// (6 decimals). AverageCost is kept even when Quantity is zero or negative — it is the last known
// cost, used to value an issue when there is nothing in stock (negative stock, D2 Warn).
public readonly record struct CostPosition(decimal Quantity, decimal Value, decimal AverageCost)
{
    public static readonly CostPosition Empty = new(0m, 0m, 0m);
}

// The result of one move. MoveValue is the value carried by the move itself (what the receipt
// adds, what the issue removes). Correction is the part of the document's stock posting that can't
// stay in stock and moves to cost of goods sold: positive = Dr COGS / Cr Inventory, negative =
// Dr Inventory / Cr COGS. It is always posted − (Value after − Value before).
public readonly record struct CostResult(CostPosition After, decimal MoveValue, decimal Correction);

// docs/INVENTORY_PLAN.md §5.2 — weighted average cost (perpetual), the one place this arithmetic
// lives. Pure functions over decimals: no database, no clock, so every rule is unit-tested here.
//
//   receipt:  avg = (qty × avg + value) / (qty + incoming qty); restarts at the incoming unit cost
//             when stock was zero or negative
//   issue:    value = round₂(avg × qty); the issue that empties stock takes the exact remaining
//             value, so zero quantity always means zero value and rounding never accumulates
//   revalue:  value-only change spread over the units in stock; with nothing in stock it all goes
//             to cost of goods sold
public static class AverageCost
{
    public const int CostDecimals = 6;

    public static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
    public static decimal UnitCost(decimal value) => Math.Round(value, CostDecimals, MidpointRounding.AwayFromZero);

    public static CostResult Receive(CostPosition before, decimal quantity, decimal value)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), quantity, "A receipt needs a positive quantity.");
        if (value < 0) throw new ArgumentOutOfRangeException(nameof(value), value, "A receipt can't carry a negative value.");
        value = Money(value);
        var quantityAfter = before.Quantity + quantity;

        CostPosition after;
        if (before.Quantity >= 0)
        {
            var valueAfter = before.Value + value;
            after = new CostPosition(quantityAfter, valueAfter, UnitCost(valueAfter / quantityAfter));
        }
        else
        {
            // Covering negative stock (D4): the units issued below zero went out at the old
            // average; now the real cost is known, stock restarts at the incoming unit cost and the
            // difference is a correction to cost of goods sold (a simple form of Odoo's "vacuum").
            var incomingUnitCost = UnitCost(value / quantity);
            after = new CostPosition(quantityAfter, Money(quantityAfter * incomingUnitCost), incomingUnitCost);
        }

        return new CostResult(after, value, Correction(value, before, after));
    }

    public static CostResult Issue(CostPosition before, decimal quantity)
    {
        if (quantity <= 0) throw new ArgumentOutOfRangeException(nameof(quantity), quantity, "An issue needs a positive quantity.");
        var quantityAfter = before.Quantity - quantity;

        decimal moveValue;
        if (before.Quantity > 0 && quantity >= before.Quantity)
        {
            // Empties stock (or goes below zero under Warn): the units in stock leave with exactly
            // their remaining value; anything beyond is valued at the last average.
            moveValue = before.Value + Money((quantity - before.Quantity) * before.AverageCost);
        }
        else
        {
            moveValue = Money(quantity * before.AverageCost);
        }

        var after = new CostPosition(quantityAfter, before.Value - moveValue, before.AverageCost);
        return new CostResult(after, moveValue, Correction(-moveValue, before, after));
    }

    // A change in value with no change in quantity — a supplier credit note or price correction on
    // goods already received (D13). Positive raises stock value, negative lowers it.
    public static CostResult Revalue(CostPosition before, decimal valueDelta)
    {
        valueDelta = Money(valueDelta);
        CostPosition after;
        if (before.Quantity > 0 && before.Value + valueDelta >= 0)
        {
            var valueAfter = before.Value + valueDelta;
            after = new CostPosition(before.Quantity, valueAfter, UnitCost(valueAfter / before.Quantity));
        }
        else
        {
            // Nothing in stock to carry it (or it would turn stock value negative): the goods have
            // been sold, so the change belongs to cost of goods sold.
            after = before;
        }

        return new CostResult(after, valueDelta, Correction(valueDelta, before, after));
    }

    // The value at which a quantity would leave stock right now (for previews and count surpluses).
    public static decimal ValueOf(CostPosition position, decimal quantity) => Money(quantity * position.AverageCost);

    private static decimal Correction(decimal posted, CostPosition before, CostPosition after) =>
        posted - (after.Value - before.Value);
}
