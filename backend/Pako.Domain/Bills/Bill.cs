using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;

namespace Pako.Domain.Bills;

public enum BillState
{
    Draft,
    Posted,
    Cancelled
}

public enum DocumentType
{
    Bill,
    CreditNote
}

public class Bill
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid PartnerId { get; set; }
    public string? VendorReference { get; set; }
    public DateOnly IssueDate { get; set; }
    public DateOnly DueDate { get; set; }
    public BillState State { get; set; } = BillState.Draft;
    public DocumentType DocumentType { get; set; } = DocumentType.Bill;
    public Guid? OriginalBillId { get; set; }
    public Guid? JournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<BillLine> Lines { get; set; } = new();

    public JournalEntry Post(
        Company company,
        Guid journalId,
        Guid payableAccountId,
        ITaxComputationService taxComputationService,
        IReadOnlyDictionary<Guid, TaxDefinition> taxDefinitionsById,
        Guid reverseChargeInputVatAccountId,
        Guid reverseChargeOutputVatAccountId)
    {
        if (State != BillState.Draft)
        {
            throw new InvalidOperationException(
                $"Bill {Id} cannot be posted from state {State}; only Draft bills can be posted.");
        }

        if (Lines.Count == 0)
        {
            throw new InvalidOperationException($"Bill {Id} has no lines.");
        }

        // Same reversal shape as Invoice.Post: a vendor credit note keeps positive line
        // quantities/prices, only which side of each line gets the amount reverses.
        var isCreditNote = DocumentType == DocumentType.CreditNote;
        var journalEntryLines = new List<JournalEntryLine>();
        var totalWithTax = 0m;

        foreach (var line in Lines)
        {
            // Line entry is gross (brutto) — line.UnitPrice is the vendor's actual per-unit
            // price, VAT included, not a pre-VAT net price. gross is what's owed for this line;
            // the expense line only gets the net portion once VAT is backed out.
            var gross = Math.Round(line.Quantity * line.UnitPrice * (1 - line.DiscountPercent / 100m), 2, MidpointRounding.AwayFromZero);
            var netAmount = gross;
            Guid? taxDefinitionId = null;
            totalWithTax += gross;

            if (line.TaxDefinitionId is { } lineTaxDefinitionId)
            {
                if (!taxDefinitionsById.TryGetValue(lineTaxDefinitionId, out var taxDefinition) || !taxDefinition.IsActive)
                {
                    throw new InvalidOperationException(
                        $"Bill {Id} references unknown or inactive tax definition {lineTaxDefinitionId}.");
                }

                taxDefinitionId = lineTaxDefinitionId;
                var computation = taxComputationService.ComputeFromGross(gross, taxDefinition);
                netAmount = computation.NetAmount;

                foreach (var postingLine in computation.PostingLines)
                {
                    journalEntryLines.Add(new JournalEntryLine
                    {
                        Id = Guid.NewGuid(),
                        AccountId = postingLine.AccountId,
                        Debit = isCreditNote ? 0m : postingLine.Amount,
                        Credit = isCreditNote ? postingLine.Amount : 0m,
                        Description = postingLine.Tag,
                        TaxId = lineTaxDefinitionId
                    });
                }

                // R10 (AUTO) — see Invoice.Post's identical comment. Bills are the realistic
                // case for RC18 (Google Ads, Meta, Microsoft 365, hosting, imported services).
                // For a reverse-charge line, ComputeFromGross already returned netAmount ==
                // gross (the foreign vendor never charged VAT, nothing to back out).
                if (taxDefinition.IsReverseCharge)
                {
                    var reverseChargeAmount = Math.Round(gross * taxDefinition.Rate, 2, MidpointRounding.AwayFromZero);
                    journalEntryLines.Add(new JournalEntryLine
                    {
                        Id = Guid.NewGuid(),
                        AccountId = reverseChargeInputVatAccountId,
                        Debit = reverseChargeAmount,
                        Credit = 0m,
                        Description = "Reverse charge input VAT",
                        TaxId = lineTaxDefinitionId
                    });
                    journalEntryLines.Add(new JournalEntryLine
                    {
                        Id = Guid.NewGuid(),
                        AccountId = reverseChargeOutputVatAccountId,
                        Debit = 0m,
                        Credit = reverseChargeAmount,
                        Description = "Reverse charge output VAT",
                        TaxId = lineTaxDefinitionId
                    });
                }
            }

            journalEntryLines.Add(new JournalEntryLine
            {
                Id = Guid.NewGuid(),
                AccountId = line.ExpenseAccountId,
                Debit = isCreditNote ? 0m : netAmount,
                Credit = isCreditNote ? netAmount : 0m,
                Description = line.Description,
                TaxId = taxDefinitionId
            });
        }

        journalEntryLines.Insert(0, new JournalEntryLine
        {
            Id = Guid.NewGuid(),
            AccountId = payableAccountId,
            PartnerId = PartnerId,
            Credit = isCreditNote ? 0m : totalWithTax,
            Debit = isCreditNote ? totalWithTax : 0m
        });

        var journalEntry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = CompanyId,
            JournalId = journalId,
            Date = IssueDate,
            Reference = VendorReference,
            Lines = journalEntryLines
        };

        journalEntry.Post(company);

        JournalEntryId = journalEntry.Id;
        State = BillState.Posted;

        return journalEntry;
    }
}
