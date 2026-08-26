namespace Pako.Domain.Companies;

public class Company
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid? FirmId { get; set; }
    public DateOnly? AccountingLockDate { get; set; }
    public DateOnly? TaxLockDate { get; set; }
    public int NextInvoiceNumber { get; set; } = 1;
    public int NextCreditNoteNumber { get; set; } = 1;
    public int NextDebitNoteNumber { get; set; } = 1;
    public int NextDownPaymentNumber { get; set; } = 1;

    // Kosovo VAT Law Article 45/56 requires invoice numbering to be gapless and strictly
    // monotonic per company. This mints the number and advances the counter together so a
    // failed Invoice.Post (e.g. a lock-date violation) never burns a number.
    public string ReserveNextInvoiceNumber()
    {
        var number = $"INV-{NextInvoiceNumber:D4}";
        NextInvoiceNumber++;
        return number;
    }

    // Kosovo VAT Law Article 47.2.2 requires a credit note to carry its own sequential number,
    // separate from the Article 45/56 invoice series above — a distinct counter, not a shared one.
    public string ReserveNextCreditNoteNumber()
    {
        var number = $"CN-{NextCreditNoteNumber:D4}";
        NextCreditNoteNumber++;
        return number;
    }

    // Kosovo VAT Law Article 47.2.2 requires the same own-sequence treatment for debit notes as
    // for credit notes — a distinct counter from both the invoice and credit-note series.
    public string ReserveNextDebitNoteNumber()
    {
        var number = $"DN-{NextDebitNoteNumber:D4}";
        NextDebitNoteNumber++;
        return number;
    }

    // A down-payment invoice is still a document PAKO issues to a customer, so it gets the same
    // own-sequence legal-numbering treatment as invoices/credit/debit notes, a distinct counter.
    public string ReserveNextDownPaymentNumber()
    {
        var number = $"DP-{NextDownPaymentNumber:D4}";
        NextDownPaymentNumber++;
        return number;
    }
}
