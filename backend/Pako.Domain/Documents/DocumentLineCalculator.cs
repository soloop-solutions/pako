using Pako.Domain.Ledger;
using Pako.Domain.Tax;

namespace Pako.Domain.Documents;

public record DocumentLineResult(decimal Gross, decimal NetAmount, IReadOnlyList<JournalEntryLine> Lines);

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
        Guid reverseChargeOutputVatAccountId)
    {
        var gross = Math.Round(quantity * unitPrice * (1 - discountPercent / 100m), 2, MidpointRounding.AwayFromZero);
        var netAmount = gross;
        var lines = new List<JournalEntryLine>();
        var creditTheLine = creditsOnNormalSide != isCreditNote;

        if (taxDefinition is not null)
        {
            var computation = taxComputationService.ComputeFromGross(gross, taxDefinition);
            netAmount = computation.NetAmount;

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
            // entered amount, the same regardless of isCreditNote/creditsOnNormalSide.
            if (taxDefinition.IsReverseCharge)
            {
                var reverseChargeAmount = Math.Round(gross * taxDefinition.Rate, 2, MidpointRounding.AwayFromZero);
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
