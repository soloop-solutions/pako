namespace Pako.Domain.Reconciliation;

public static class ReconciliationValidator
{
    public static void Validate(
        Guid journalEntryLineId,
        bool settlementLineIsPosted,
        Guid settlementLineAccountId,
        Guid controlAccountId,
        Guid? settlementLinePartnerId,
        Guid documentId,
        bool documentIsPosted,
        Guid documentPartnerId,
        decimal documentTotal,
        decimal alreadyReconciled,
        decimal amount)
    {
        if (!documentIsPosted)
        {
            throw new UnpostedReconciliationDocumentException(documentId);
        }

        if (!settlementLineIsPosted)
        {
            throw new UnpostedSettlementLineException(journalEntryLineId);
        }

        if (settlementLineAccountId != controlAccountId)
        {
            throw new ReconciliationAccountMismatchException(journalEntryLineId, controlAccountId, settlementLineAccountId);
        }

        if (settlementLinePartnerId != documentPartnerId)
        {
            throw new ReconciliationPartnerMismatchException(journalEntryLineId, documentPartnerId, settlementLinePartnerId);
        }

        if (amount <= 0)
        {
            throw new ArgumentException("Reconciliation amount must be positive.", nameof(amount));
        }

        var outstanding = documentTotal - alreadyReconciled;
        if (amount > outstanding)
        {
            throw new OverReconciliationException(outstanding, amount);
        }
    }
}
