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
        decimal amount,
        decimal settlementLineAmount,
        decimal alreadyReconciledForLine)
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

        // The document-level check above only guards the invoice/bill side. It says nothing about
        // whether this same settlement JournalEntryLine has already had its own amount consumed by
        // OTHER reconciliations (e.g. reconciled against a different invoice) — without this, one
        // real receipt could be reconciled in full against two separate documents. A single
        // settlement line legitimately funds multiple documents (a bulk receipt split across
        // several invoices), so the cap here is the line's own amount, not "one document per line".
        if (alreadyReconciledForLine + amount > settlementLineAmount)
        {
            throw new SettlementLineOverConsumedException(journalEntryLineId, settlementLineAmount, alreadyReconciledForLine + amount);
        }
    }
}
