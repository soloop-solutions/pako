namespace Pako.Domain.Reporting;

public record VatBoxAmount(string Box, decimal Net, decimal Vat);

public record VatBoxTotal(decimal Net, decimal Vat);

public record VatDeclarationResult(
    IReadOnlyDictionary<string, VatBoxTotal> Boxes,
    decimal TotalVatCalculated,
    decimal TotalVatDeductible,
    decimal CarriedCredit,
    decimal RemainingCredit,
    decimal RefundRequested,
    decimal CreditForNextPeriod,
    decimal VatPayable);

public static class VatDeclaration
{
    public static readonly IReadOnlyList<string> CalculatedVatBoxes =
        new[] { "12", "14", "16", "18", "20", "22", "24", "26", "28" };

    public static readonly IReadOnlyList<string> DeductibleVatBoxes =
        new[] { "35", "37", "39", "41", "43", "45", "47", "49", "51", "53", "55", "57", "59", "61", "63", "65" };

    private static readonly string[] ExemptWithCreditParts = { "10a", "10b", "10c" };

    public static VatDeclarationResult Calculate(
        IEnumerable<VatBoxAmount> amounts, decimal carriedCredit, decimal refundRequested)
    {
        var boxes = amounts
            .GroupBy(a => a.Box)
            .ToDictionary(g => g.Key, g => new VatBoxTotal(Round(g.Sum(a => a.Net)), Round(g.Sum(a => a.Vat))));

        boxes["10"] = new VatBoxTotal(Round(ExemptWithCreditParts.Sum(p => boxes.GetValueOrDefault(p)?.Net ?? 0m)), 0m);

        var totalCalculated = Round(CalculatedVatBoxes.Sum(b => boxes.GetValueOrDefault(b)?.Vat ?? 0m));
        var totalDeductible = Round(DeductibleVatBoxes.Sum(b => boxes.GetValueOrDefault(b)?.Vat ?? 0m));
        carriedCredit = Round(carriedCredit);
        refundRequested = Round(refundRequested);

        var remaining = Math.Max(Round(totalDeductible + carriedCredit - totalCalculated), 0m);
        var payable = Math.Max(Round(totalCalculated - totalDeductible - carriedCredit), 0m);

        return new VatDeclarationResult(
            boxes, totalCalculated, totalDeductible, carriedCredit, remaining, refundRequested,
            Round(remaining - refundRequested), payable);
    }

    private static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}
