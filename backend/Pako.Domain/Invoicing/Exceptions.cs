namespace Pako.Domain.Invoicing;

public class PostedInvoiceImmutableException : Exception
{
    public Guid InvoiceId { get; }

    public PostedInvoiceImmutableException(Guid invoiceId)
        : base($"Invoice {invoiceId} is Posted and cannot be modified or deleted; create a credit note instead.")
    {
        InvoiceId = invoiceId;
    }
}
