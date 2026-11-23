namespace Pako.Domain.Payments;

public enum PaymentState
{
    Posted,     // JE posted, outstanding account hit, awaiting bank reconciliation
    Reconciled, // Bank statement matched, cleared to bank
    Cancelled   // Reversed
}

public enum PaymentDirection
{
    Inbound,  // Customer paying us (receipt)
    Outbound  // Us paying a vendor (payment)
}

[Pako.Domain.Shared.Audited]
public class Payment
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public PaymentDirection Direction { get; set; }
    public Guid PartnerId { get; set; }
    public decimal Amount { get; set; }
    public DateOnly Date { get; set; }
    public string? Reference { get; set; }

    // The JE that hits Outstanding <-> AR/AP
    public Guid JournalEntryId { get; set; }

    // The JE that clears Outstanding <-> Bank (set during bank rec)
    public Guid? ClearingJournalEntryId { get; set; }

    // The bank/cash account this payment ultimately settles to
    public Guid DestinationAccountId { get; set; }

    // The outstanding account used (from journal config)
    public Guid OutstandingAccountId { get; set; }

    // Link to the document being paid (exactly one is set)
    public Guid? InvoiceId { get; set; }
    public Guid? BillId { get; set; }

    // Set when cleared during bank rec
    public Guid? BankStatementLineId { get; set; }

    public PaymentState State { get; set; } = PaymentState.Posted;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? CreatedByUserId { get; set; }
}
