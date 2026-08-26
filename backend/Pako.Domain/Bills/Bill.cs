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

public class Bill
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid PartnerId { get; set; }
    public string? VendorReference { get; set; }
    public DateOnly IssueDate { get; set; }
    public DateOnly DueDate { get; set; }
    public BillState State { get; set; } = BillState.Draft;
    public Guid? JournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<BillLine> Lines { get; set; } = new();

    public JournalEntry Post(
        Company company,
        Guid journalId,
        Guid payableAccountId,
        ITaxComputationService taxComputationService,
        IReadOnlyDictionary<Guid, TaxDefinition> taxDefinitionsById)
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

        var journalEntryLines = new List<JournalEntryLine>();
        var totalWithTax = 0m;

        foreach (var line in Lines)
        {
            var net = Math.Round(line.Quantity * line.UnitPrice, 2, MidpointRounding.AwayFromZero);
            var netLine = new JournalEntryLine
            {
                Id = Guid.NewGuid(),
                AccountId = line.ExpenseAccountId,
                Debit = net,
                Credit = 0m,
                Description = line.Description
            };
            totalWithTax += net;

            if (line.TaxDefinitionId is { } taxDefinitionId)
            {
                if (!taxDefinitionsById.TryGetValue(taxDefinitionId, out var taxDefinition) || !taxDefinition.IsActive)
                {
                    throw new InvalidOperationException(
                        $"Bill {Id} references unknown or inactive tax definition {taxDefinitionId}.");
                }

                netLine.TaxId = taxDefinitionId;
                var computation = taxComputationService.Compute(net, taxDefinition);
                totalWithTax += computation.TaxAmount;

                foreach (var postingLine in computation.PostingLines)
                {
                    journalEntryLines.Add(new JournalEntryLine
                    {
                        Id = Guid.NewGuid(),
                        AccountId = postingLine.AccountId,
                        Debit = postingLine.Amount,
                        Credit = 0m,
                        Description = postingLine.Tag,
                        TaxId = taxDefinitionId
                    });
                }
            }

            journalEntryLines.Add(netLine);
        }

        journalEntryLines.Insert(0, new JournalEntryLine
        {
            Id = Guid.NewGuid(),
            AccountId = payableAccountId,
            PartnerId = PartnerId,
            Credit = totalWithTax,
            Debit = 0m
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
