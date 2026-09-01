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

public enum DocumentType
{
    Invoice,
    CreditNote,
    DebitNote,
    DownPayment
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
    public DocumentType DocumentType { get; set; } = DocumentType.Invoice;
    public Guid? OriginalInvoiceId { get; set; }
    public Guid? JournalEntryId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<InvoiceLine> Lines { get; set; } = new();

    public JournalEntry Post(
        Company company,
        Guid journalId,
        Guid receivableAccountId,
        ITaxComputationService taxComputationService,
        IReadOnlyDictionary<Guid, TaxDefinition> taxDefinitionsById,
        Guid reverseChargeInputVatAccountId,
        Guid reverseChargeOutputVatAccountId)
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

        // A credit note carries the same positive line quantities/prices as a normal invoice —
        // only which side of each line gets the amount (Debit vs Credit) reverses, mirroring
        // Odoo's out_invoice/out_refund move_type distinction rather than negative amounts.
        var isCreditNote = DocumentType == DocumentType.CreditNote;
        var journalEntryLines = new List<JournalEntryLine>();
        var totalWithTax = 0m;

        foreach (var line in Lines)
        {
            // Line entry is gross (brutto) — line.UnitPrice is what the customer actually pays
            // per unit, VAT included, not a pre-VAT net price. gross is the amount owed for
            // this line; the revenue line only gets the net portion once VAT is backed out.
            var gross = Math.Round(line.Quantity * line.UnitPrice * (1 - line.DiscountPercent / 100m), 2, MidpointRounding.AwayFromZero);
            var netAmount = gross;
            Guid? taxDefinitionId = null;
            totalWithTax += gross;

            if (line.TaxDefinitionId is { } lineTaxDefinitionId)
            {
                if (!taxDefinitionsById.TryGetValue(lineTaxDefinitionId, out var taxDefinition) || !taxDefinition.IsActive)
                {
                    throw new InvalidOperationException(
                        $"Invoice {Id} references unknown or inactive tax definition {lineTaxDefinitionId}.");
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
                        Debit = isCreditNote ? postingLine.Amount : 0m,
                        Credit = isCreditNote ? 0m : postingLine.Amount,
                        Description = postingLine.Tag,
                        TaxId = lineTaxDefinitionId
                    });
                }

                // R10 (AUTO): a reverse-charge code (RC18) has no ordinary repartition lines —
                // it self-assesses VAT that's neither owed to nor by the counterparty, so it
                // can't flow through the totalWithTax/receivable amount like a normal tax. Books
                // Dr 113300 / Cr 210300 on the full entered amount — for a reverse-charge line,
                // ComputeFromGross already returned netAmount == gross (the foreign vendor never
                // charged VAT, so there's nothing to back out).
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
                AccountId = line.RevenueAccountId,
                Debit = isCreditNote ? netAmount : 0m,
                Credit = isCreditNote ? 0m : netAmount,
                Description = line.Description,
                TaxId = taxDefinitionId
            });
        }

        journalEntryLines.Insert(0, new JournalEntryLine
        {
            Id = Guid.NewGuid(),
            AccountId = receivableAccountId,
            PartnerId = PartnerId,
            Debit = isCreditNote ? 0m : totalWithTax,
            Credit = isCreditNote ? totalWithTax : 0m
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

        InvoiceNumber = DocumentType switch
        {
            DocumentType.CreditNote => company.ReserveNextCreditNoteNumber(),
            DocumentType.DebitNote => company.ReserveNextDebitNoteNumber(),
            DocumentType.DownPayment => company.ReserveNextDownPaymentNumber(),
            _ => company.ReserveNextInvoiceNumber()
        };
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
