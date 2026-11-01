using Pako.Domain.Ledger;

namespace Pako.Domain.Reporting;

public record AccountMovement(Guid AccountId, string Code, string Name, CashFlowCategory Category, decimal Debit, decimal Credit);

public record CashFlowResult(
    IReadOnlyList<AccountMovement> Operating,
    IReadOnlyList<AccountMovement> Investing,
    IReadOnlyList<AccountMovement> Financing,
    decimal NetChange,
    decimal ClosingComputed,
    decimal Difference);

public static class CashFlowStatement
{
    public static CashFlowResult Calculate(
        decimal netIncome,
        IEnumerable<AccountMovement> nonCashMovements,
        decimal openingCash,
        decimal closingCashActual)
    {
        var counted = nonCashMovements.Where(m => m.Category != CashFlowCategory.None).ToList();
        var operating = counted.Where(m => m.Category == CashFlowCategory.Operating).ToList();
        var investing = counted.Where(m => m.Category == CashFlowCategory.Investing).ToList();
        var financing = counted.Where(m => m.Category == CashFlowCategory.Financing).ToList();

        var netChange = netIncome + counted.Sum(m => m.Credit - m.Debit);
        var closingComputed = openingCash + netChange;

        return new CashFlowResult(operating, investing, financing, netChange, closingComputed, closingCashActual - closingComputed);
    }
}
