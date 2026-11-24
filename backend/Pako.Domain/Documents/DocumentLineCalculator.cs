using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;

namespace Pako.Domain.Documents;

public record DocumentLineResult(decimal Gross, decimal NetAmount, IReadOnlyList<JournalEntryLine> Lines);

// What a printed line shows: the entered amount before and after the line discount (both on the
// document's own price basis, VAT-inclusive under GrossInclusive), then net, VAT and total exactly as
// posting computes them.
//
// UnitPriceNet / UnitPriceGross (client request 2026-11-23): the entered unit price (before the line
// discount) on both bases, for the printed invoice's "price without VAT / with VAT" columns. They are
// the line's own tax computation run on one unit, so they are informational: the line totals above
// are what posts, and total ÷ quantity may differ from them by a cent.
public record DocumentLineAmounts(decimal AmountBeforeDiscount, decimal DiscountAmount, decimal NetAmount, decimal TaxAmount, decimal GrossAmount,
    decimal UnitPriceNet = 0m, decimal UnitPriceGross = 0m)
{
    public static DocumentLineAmounts Sum(IEnumerable<DocumentLineAmounts> lines)
    {
        var all = lines.ToList();
        return new DocumentLineAmounts(
            all.Sum(l => l.AmountBeforeDiscount), all.Sum(l => l.DiscountAmount), all.Sum(l => l.NetAmount),
            all.Sum(l => l.TaxAmount), all.Sum(l => l.GrossAmount));
    }
}

// S0.2: the gross -> discount -> VAT -> net block was duplicated inside Invoice.Post()'s and
// Bill.Post()'s `foreach (var line in Lines)` loops. Extracted here, shared by both, zero EF
// dependency — same "static function over already-loaded primitives" shape as
// Pako.Domain.Reconciliation.ReconciliationValidator / Pako.Domain.Ledger.PostingRuleValidator.
//
// Invoice's normal (non-credit-note) posting *credits* the tax/net lines (VAT Payable is a
// liability, revenue is credited); Bill's normal posting *debits* them (VAT Receivable is an
// asset, expense is debited) — opposite conventions, not just a shared `isCreditNote` flip. A
// credit note flips whichever side is normal for that document. `creditsOnNormalSide` captures
// which convention the caller uses (true for Invoice, false for Bill); XORed with `isCreditNote`
// to get the actual side for this posting.
public static class DocumentLineCalculator
{
    public static DocumentLineAmounts Amounts(
        decimal quantity,
        decimal unitPrice,
        decimal discountPercent,
        TaxDefinition? taxDefinition,
        ITaxComputationService taxComputationService,
        PriceMode priceMode = PriceMode.GrossInclusive)
    {
        var beforeDiscount = Math.Round(quantity * unitPrice, 2, MidpointRounding.AwayFromZero);
        // Same rounding as Calculate below, so the printed line always agrees with the posted entry.
        var enteredAmount = Math.Round(quantity * unitPrice * (1 - discountPercent / 100m), 2, MidpointRounding.AwayFromZero);
        var discount = beforeDiscount - enteredAmount;
        if (taxDefinition is null)
        {
            return new DocumentLineAmounts(beforeDiscount, discount, enteredAmount, 0m, enteredAmount, unitPrice, unitPrice);
        }

        var computation = priceMode == PriceMode.NetExclusive
            ? taxComputationService.Compute(enteredAmount, taxDefinition)
            : taxComputationService.ComputeFromGross(enteredAmount, taxDefinition);
        var (unitNet, unitGross) = UnitPrices(unitPrice, taxDefinition, taxComputationService, priceMode);
        return new DocumentLineAmounts(beforeDiscount, discount, computation.NetAmount, computation.TaxAmount, computation.TotalAmount, unitNet, unitGross);
    }

    // The entered unit price on both bases. The side the user typed is kept exactly as entered; the
    // other side is the same tax computation the line uses, on one unit. A reverse-charge line carries
    // no VAT for the customer, so both sides are the entered price.
    private static (decimal Net, decimal Gross) UnitPrices(
        decimal unitPrice, TaxDefinition taxDefinition, ITaxComputationService taxComputationService, PriceMode priceMode)
    {
        if (taxDefinition.IsReverseCharge) return (unitPrice, unitPrice);
        return priceMode == PriceMode.NetExclusive
            ? (unitPrice, taxComputationService.Compute(unitPrice, taxDefinition).TotalAmount)
            : (taxComputationService.ComputeFromGross(unitPrice, taxDefinition).NetAmount, unitPrice);
    }

    public static DocumentLineResult Calculate(
        decimal quantity,
        decimal unitPrice,
        decimal discountPercent,
        Guid netAccountId,
        string description,
        TaxDefinition? taxDefinition,
        bool isCreditNote,
        bool creditsOnNormalSide,
        ITaxComputationService taxComputationService,
        Guid reverseChargeInputVatAccountId,
        Guid reverseChargeOutputVatAccountId,
        PriceMode priceMode = PriceMode.GrossInclusive)
    {
        // C1: unitPrice is VAT-inclusive (GrossInclusive, the existing/default convention) or
        // VAT-exclusive (NetExclusive) depending on the document's own PriceMode — the entered
        // amount itself is just "whatever the line's own unit says", VAT direction is resolved
        // below by picking which TaxComputationService method backs it out of vs. adds it on top
        // of. `gross`/`netAmount` below always end up meaning the same thing regardless of mode
        // (the true VAT-inclusive/exclusive totals), so the rest of this method — and every
        // caller — is unaffected by which mode produced them.
        var enteredAmount = Math.Round(quantity * unitPrice * (1 - discountPercent / 100m), 2, MidpointRounding.AwayFromZero);
        var gross = enteredAmount;
        var netAmount = enteredAmount;
        var lines = new List<JournalEntryLine>();
        var creditTheLine = creditsOnNormalSide != isCreditNote;

        if (taxDefinition is not null)
        {
            var computation = priceMode == PriceMode.NetExclusive
                ? taxComputationService.Compute(enteredAmount, taxDefinition)
                : taxComputationService.ComputeFromGross(enteredAmount, taxDefinition);
            netAmount = computation.NetAmount;
            gross = computation.TotalAmount;

            foreach (var postingLine in computation.PostingLines)
            {
                lines.Add(new JournalEntryLine
                {
                    Id = Guid.NewGuid(),
                    AccountId = postingLine.AccountId,
                    Debit = creditTheLine ? 0m : postingLine.Amount,
                    Credit = creditTheLine ? postingLine.Amount : 0m,
                    Description = postingLine.Tag,
                    TaxId = taxDefinition.Id
                });
            }

            // R10 (AUTO): a reverse-charge code (RC18) has no ordinary repartition lines — it
            // self-assesses VAT that's neither owed to nor by the counterparty, so it can't flow
            // through the normal posting-line loop above. Books Dr input / Cr output on the full
            // entered amount (which is already fully net regardless of PriceMode — the foreign
            // vendor never charged VAT, see ComputeFromGross's own reverse-charge bypass), the
            // same regardless of isCreditNote/creditsOnNormalSide.
            if (taxDefinition.IsReverseCharge)
            {
                var reverseChargeAmount = Math.Round(enteredAmount * taxDefinition.Rate, 2, MidpointRounding.AwayFromZero);
                lines.Add(new JournalEntryLine
                {
                    Id = Guid.NewGuid(),
                    AccountId = reverseChargeInputVatAccountId,
                    Debit = reverseChargeAmount,
                    Credit = 0m,
                    Description = "Reverse charge input VAT",
                    TaxId = taxDefinition.Id
                });
                lines.Add(new JournalEntryLine
                {
                    Id = Guid.NewGuid(),
                    AccountId = reverseChargeOutputVatAccountId,
                    Debit = 0m,
                    Credit = reverseChargeAmount,
                    Description = "Reverse charge output VAT",
                    TaxId = taxDefinition.Id
                });
            }
        }

        lines.Add(new JournalEntryLine
        {
            Id = Guid.NewGuid(),
            AccountId = netAccountId,
            Debit = creditTheLine ? 0m : netAmount,
            Credit = creditTheLine ? netAmount : 0m,
            Description = description,
            TaxId = taxDefinition?.Id
        });

        return new DocumentLineResult(gross, netAmount, lines);
    }
}
