namespace Pako.Domain.Reconciliation;

public class UnpostedSettlementLineException : Exception
{
    public Guid JournalEntryLineId { get; }

    public UnpostedSettlementLineException(Guid journalEntryLineId)
        : base($"Journal entry line {journalEntryLineId} belongs to a journal entry that is not Posted; only a posted settlement line can be reconciled.")
    {
        JournalEntryLineId = journalEntryLineId;
    }
}

public class UnpostedReconciliationDocumentException : Exception
{
    public Guid DocumentId { get; }

    public UnpostedReconciliationDocumentException(Guid documentId)
        : base($"Document {documentId} is not Posted; only a posted invoice/bill can be reconciled.")
    {
        DocumentId = documentId;
    }
}

public class ReconciliationAccountMismatchException : Exception
{
    public Guid JournalEntryLineId { get; }
    public Guid ExpectedAccountId { get; }
    public Guid ActualAccountId { get; }

    public ReconciliationAccountMismatchException(Guid journalEntryLineId, Guid expectedAccountId, Guid actualAccountId)
        : base($"Journal entry line {journalEntryLineId} posts to account {actualAccountId}, but the document's control account is {expectedAccountId}.")
    {
        JournalEntryLineId = journalEntryLineId;
        ExpectedAccountId = expectedAccountId;
        ActualAccountId = actualAccountId;
    }
}

public class ReconciliationPartnerMismatchException : Exception
{
    public Guid JournalEntryLineId { get; }
    public Guid ExpectedPartnerId { get; }
    public Guid? ActualPartnerId { get; }

    public ReconciliationPartnerMismatchException(Guid journalEntryLineId, Guid expectedPartnerId, Guid? actualPartnerId)
        : base($"Journal entry line {journalEntryLineId} has partner {(actualPartnerId?.ToString() ?? "none")}, but the document's partner is {expectedPartnerId}.")
    {
        JournalEntryLineId = journalEntryLineId;
        ExpectedPartnerId = expectedPartnerId;
        ActualPartnerId = actualPartnerId;
    }
}

public class OverReconciliationException : Exception
{
    public decimal Outstanding { get; }
    public decimal Amount { get; }

    public OverReconciliationException(decimal outstanding, decimal amount)
        : base($"Reconciliation amount {amount} exceeds the outstanding balance {outstanding}.")
    {
        Outstanding = outstanding;
        Amount = amount;
    }
}

public class SettlementLineOverConsumedException : Exception
{
    public Guid JournalEntryLineId { get; }
    public decimal LineAmount { get; }
    public decimal AttemptedTotal { get; }

    public SettlementLineOverConsumedException(Guid journalEntryLineId, decimal lineAmount, decimal attemptedTotal)
        : base($"Journal entry line {journalEntryLineId} has amount {lineAmount}, but {attemptedTotal} would be reconciled against it in total.")
    {
        JournalEntryLineId = journalEntryLineId;
        LineAmount = lineAmount;
        AttemptedTotal = attemptedTotal;
    }
}
