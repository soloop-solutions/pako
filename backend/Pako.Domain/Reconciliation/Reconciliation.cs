namespace Pako.Domain.Reconciliation;

public class Reconciliation
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? InvoiceId { get; set; }
    public Guid? BillId { get; set; }
    public Guid JournalEntryLineId { get; set; }
    public decimal Amount { get; set; }
    public DateTime ReconciledAt { get; set; } = DateTime.UtcNow;

    public static Reconciliation ForInvoice(Guid companyId, Guid invoiceId, Guid journalEntryLineId, decimal amount)
    {
        if (amount <= 0)
        {
            throw new ArgumentException("Reconciliation amount must be positive.", nameof(amount));
        }

        return new Reconciliation
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            InvoiceId = invoiceId,
            JournalEntryLineId = journalEntryLineId,
            Amount = amount
        };
    }

    public static Reconciliation ForBill(Guid companyId, Guid billId, Guid journalEntryLineId, decimal amount)
    {
        if (amount <= 0)
        {
            throw new ArgumentException("Reconciliation amount must be positive.", nameof(amount));
        }

        return new Reconciliation
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            BillId = billId,
            JournalEntryLineId = journalEntryLineId,
            Amount = amount
        };
    }
}
