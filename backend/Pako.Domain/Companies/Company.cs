namespace Pako.Domain.Companies;

public class Company
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid? FirmId { get; set; }
    public DateOnly? AccountingLockDate { get; set; }
    public DateOnly? TaxLockDate { get; set; }
    public int NextInvoiceNumber { get; set; } = 1;

    // Kosovo VAT Law Article 45/56 requires invoice numbering to be gapless and strictly
    // monotonic per company. This mints the number and advances the counter together so a
    // failed Invoice.Post (e.g. a lock-date violation) never burns a number.
    public string ReserveNextInvoiceNumber()
    {
        var number = $"INV-{NextInvoiceNumber:D4}";
        NextInvoiceNumber++;
        return number;
    }
}
