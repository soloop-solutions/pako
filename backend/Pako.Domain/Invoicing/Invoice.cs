using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Tax;

namespace Pako.Domain.Invoicing;

public enum InvoiceState
{
    Draft,
    Posted,
    Cancelled
}

public class Invoice
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid PartnerId { get; set; }
    public string? InvoiceNumber { get; set; }
    public DateOnly IssueDate { get; set; }
    public DateOnly DueDate { get; set; }
    public InvoiceState State { get; set; } = InvoiceState.Draft;
    public Guid? JournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<InvoiceLine> Lines { get; set; } = new();

    public JournalEntry Post(
        Company company,
        Guid journalId,
        Guid receivableAccountId,
        ITaxComputationService taxComputationService,
        IReadOnlyDictionary<Guid, TaxDefinition> taxDefinitionsById)
    {
        if (State != InvoiceState.Draft)
        {
            throw new InvalidOperationException(
                $"Invoice {Id} cannot be posted from state {State}; only Draft invoices can be posted.");
        }

        if (Lines.Count == 0)
        {
            throw new InvalidOperationException($"Invoice {Id} has no lines.");
        }

        var journalEntryLines = new List<JournalEntryLine>();
        var totalWithTax = 0m;

        foreach (var line in Lines)
        {
            var net = Math.Round(line.Quantity * line.UnitPrice, 2, MidpointRounding.AwayFromZero);
            var netLine = new JournalEntryLine
            {
                Id = Guid.NewGuid(),
                AccountId = line.RevenueAccountId,
                Credit = net,
                Debit = 0m,
                Description = line.Description
            };
            totalWithTax += net;

            if (line.TaxDefinitionId is { } taxDefinitionId)
            {
                if (!taxDefinitionsById.TryGetValue(taxDefinitionId, out var taxDefinition) || !taxDefinition.IsActive)
                {
                    throw new InvalidOperationException(
                        $"Invoice {Id} references unknown or inactive tax definition {taxDefinitionId}.");
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
                        Credit = postingLine.Amount,
                        Debit = 0m,
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
            AccountId = receivableAccountId,
            PartnerId = PartnerId,
            Debit = totalWithTax,
            Credit = 0m
        });

        var journalEntry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = CompanyId,
            JournalId = journalId,
            Date = IssueDate,
            Lines = journalEntryLines
        };

        journalEntry.Post(company);

        InvoiceNumber = company.ReserveNextInvoiceNumber();
        journalEntry.Reference = InvoiceNumber;
        JournalEntryId = journalEntry.Id;
        State = InvoiceState.Posted;

        // TODO(fiscal): once a company has real PEF/SEF credentials, issue a fiscal receipt here
        // via IFiscalProvider.IssueReceiptAsync after a successful post — no live hardware/SEF
        // access is available in this environment, so this is left as a documented extension
        // point rather than a forced call.

        return journalEntry;
    }
}
