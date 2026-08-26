namespace Pako.Domain.Bills;

public class PostedBillImmutableException : Exception
{
    public Guid BillId { get; }

    public PostedBillImmutableException(Guid billId)
        : base($"Bill {billId} is Posted and cannot be modified or deleted; create a debit note instead.")
    {
        BillId = billId;
    }
}
