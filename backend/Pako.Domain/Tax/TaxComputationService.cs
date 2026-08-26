namespace Pako.Domain.Tax;

// Kosovo VAT law doesn't pin down a rounding convention for the tax-law research this repo has
// done so far, so this uses the standard commercial "round half away from zero to the nearest
// cent" rule (.NET decimal's Math.Round defaults to banker's rounding, which would differ on
// exact .xx5 amounts) — revisit if Kosovo VAT-return guidance turns up a different rule.
// Each repartition line's amount is rounded independently from the net amount (not derived by
// splitting an already-rounded TaxAmount), and TaxAmount is their sum — so posting lines always
// add up to TaxAmount exactly, which matters for the caller's debit=credit ledger invariant.
public class TaxComputationService : ITaxComputationService
{
    public TaxComputationResult Compute(decimal netAmount, TaxDefinition taxDefinition)
    {
        var postingLines = taxDefinition.RepartitionLines
            .Select(r => new TaxPostingLine(
                r.AccountId,
                Math.Round(netAmount * taxDefinition.Rate * r.Percentage / 100m, 2, MidpointRounding.AwayFromZero),
                r.Tag))
            .ToList();

        var taxAmount = postingLines.Sum(l => l.Amount);

        return new TaxComputationResult(netAmount, taxAmount, netAmount + taxAmount, postingLines);
    }
}
