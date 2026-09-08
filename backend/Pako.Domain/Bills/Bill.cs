using Pako.Domain.Companies;
using Pako.Domain.Documents;
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
            TaxDefinition? taxDefinition = null;
            if (line.TaxDefinitionId is { } lineTaxDefinitionId)
            {
                if (!taxDefinitionsById.TryGetValue(lineTaxDefinitionId, out taxDefinition) || !taxDefinition.IsActive)
                {
                    throw new InvalidOperationException(
                        $"Bill {Id} references unknown or inactive tax definition {lineTaxDefinitionId}.");
                }
            }

            var result = DocumentLineCalculator.Calculate(
                line.Quantity, line.UnitPrice, line.DiscountPercent, line.ExpenseAccountId, line.Description,
                taxDefinition, isCreditNote, creditsOnNormalSide: false,
                taxComputationService, reverseChargeInputVatAccountId, reverseChargeOutputVatAccountId);

            totalWithTax += result.Gross;
            journalEntryLines.AddRange(result.Lines);
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
