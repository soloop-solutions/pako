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

    // Invoicing/Bills line entry is gross (brutto) — see ITaxComputationService's doc comment
    // for why this exists alongside Compute rather than replacing it, and why the tax amount is
    // computed as a remainder (gross - net) rather than independently as net * rate: naive
    // independent rounding of both pieces doesn't always sum back to the entered gross amount
    // (100 at 18% -> net 84.75, naive net*rate = 15.255 rounds to 15.26, total 100.01 not 100).
    public TaxComputationResult ComputeFromGross(decimal grossAmount, TaxDefinition taxDefinition)
    {
        // Reverse-charge codes (RC18): the foreign vendor never charged VAT, so the entered
        // amount is fully net regardless of gross-entry convention — R10's AUTO self-charge
        // calculation needs the full amount as its base, not a fraction backed out of it.
        if (taxDefinition.IsReverseCharge)
        {
            return new TaxComputationResult(grossAmount, 0m, grossAmount, Array.Empty<TaxPostingLine>());
        }

        var netAmount = Math.Round(grossAmount / (1 + taxDefinition.Rate), 2, MidpointRounding.AwayFromZero);
        var totalTax = grossAmount - netAmount;

        var repartitionLines = taxDefinition.RepartitionLines;
        var postingLines = new List<TaxPostingLine>(repartitionLines.Count);
        var allocated = 0m;
        for (var i = 0; i < repartitionLines.Count; i++)
        {
            var line = repartitionLines[i];
            var isLast = i == repartitionLines.Count - 1;
            var amount = isLast
                ? totalTax - allocated
                : Math.Round(totalTax * line.Percentage / 100m, 2, MidpointRounding.AwayFromZero);
            allocated += amount;
            postingLines.Add(new TaxPostingLine(line.AccountId, amount, line.Tag));
        }

        var taxAmount = postingLines.Sum(l => l.Amount);

        return new TaxComputationResult(netAmount, taxAmount, grossAmount, postingLines);
    }
}
