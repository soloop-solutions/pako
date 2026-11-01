namespace Pako.Domain.Reporting;

public record BalanceSheetEquation(decimal TotalLiabilitiesAndEquity, decimal Difference);

public static class BalanceSheetTotals
{
    public static BalanceSheetEquation Equation(decimal totalAssets, decimal totalLiabilities, decimal totalEquity)
    {
        var liabilitiesAndEquity = totalLiabilities + totalEquity;
        return new BalanceSheetEquation(liabilitiesAndEquity, totalAssets - liabilitiesAndEquity);
    }
}
