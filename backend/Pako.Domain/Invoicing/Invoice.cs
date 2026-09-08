using Pako.Domain.Companies;
using Pako.Domain.Documents;
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
    DownPayment,
    // S0.3 (Sprint 0 registers, additive/inert): appended, never inserted — DocumentType has no
    // string conversion/DB CHECK constraint, so ordinal order matters for existing stored rows.
    // Posting/numbering logic for these two is Track A's job, not Sprint 0's.
    SalesReturn,
    Proforma
}

// S0.3 (Sprint 0 registers, additive/inert): GrossInclusive matches how line entry already works
// today (see DocumentLineCalculator) — default GrossInclusive so nothing changes for existing
// callers until Track C wires NetExclusive up.
public enum PriceMode
{
    GrossInclusive,
    NetExclusive
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

    // S0.3 (Sprint 0 registers, additive/inert): not read by Post()/DocumentLineCalculator yet —
    // Track C wires PriceMode up; PaymentTermDays/GraceDays feed Track C6's aging report.
    public PriceMode PriceMode { get; set; } = PriceMode.GrossInclusive;
    public int? PaymentTermDays { get; set; }
    public int? GraceDays { get; set; }

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
            TaxDefinition? taxDefinition = null;
            if (line.TaxDefinitionId is { } lineTaxDefinitionId)
            {
                if (!taxDefinitionsById.TryGetValue(lineTaxDefinitionId, out taxDefinition) || !taxDefinition.IsActive)
                {
                    throw new InvalidOperationException(
                        $"Invoice {Id} references unknown or inactive tax definition {lineTaxDefinitionId}.");
                }
            }

            var result = DocumentLineCalculator.Calculate(
                line.Quantity, line.UnitPrice, line.DiscountPercent, line.RevenueAccountId, line.Description,
                taxDefinition, isCreditNote, creditsOnNormalSide: true,
                taxComputationService, reverseChargeInputVatAccountId, reverseChargeOutputVatAccountId);

            totalWithTax += result.Gross;
            journalEntryLines.AddRange(result.Lines);
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

        // S0.1: numbering (InvoiceNumber/journalEntry.Reference) is minted by the caller via
        // IDocumentNumberService, after this method returns successfully — see that interface's
        // doc comment for why it moved out of here.
        JournalEntryId = journalEntry.Id;
        State = InvoiceState.Posted;

        // TODO(fiscal): once a company has real PEF/SEF credentials, issue a fiscal receipt here
        // via IFiscalProvider.IssueReceiptAsync after a successful post — no live hardware/SEF
        // access is available in this environment, so this is left as a documented extension
        // point rather than a forced call.

        return journalEntry;
    }
}
