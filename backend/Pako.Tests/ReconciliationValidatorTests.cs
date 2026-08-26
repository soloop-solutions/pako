using Pako.Domain.Reconciliation;

namespace Pako.Tests;

public class ReconciliationValidatorTests
{
    private readonly Guid _journalEntryLineId = Guid.NewGuid();
    private readonly Guid _controlAccountId = Guid.NewGuid();
    private readonly Guid _partnerId = Guid.NewGuid();
    private readonly Guid _documentId = Guid.NewGuid();

    private void Validate(
        bool settlementLineIsPosted = true,
        Guid? settlementLineAccountId = null,
        Guid? settlementLinePartnerId = null,
        bool documentIsPosted = true,
        decimal documentTotal = 100m,
        decimal alreadyReconciled = 0m,
        decimal amount = 100m,
        decimal? settlementLineAmount = null,
        decimal alreadyReconciledForLine = 0m) =>
        ReconciliationValidator.Validate(
            _journalEntryLineId,
            settlementLineIsPosted,
            settlementLineAccountId ?? _controlAccountId,
            _controlAccountId,
            settlementLinePartnerId ?? _partnerId,
            _documentId,
            documentIsPosted,
            _partnerId,
            documentTotal,
            alreadyReconciled,
            amount,
            settlementLineAmount ?? amount + alreadyReconciledForLine,
            alreadyReconciledForLine);

    [Fact]
    public void Validate_FullReconciliation_Succeeds()
    {
        Validate(documentTotal: 100m, alreadyReconciled: 0m, amount: 100m);
    }

    [Fact]
    public void Validate_PartialReconciliation_Succeeds()
    {
        Validate(documentTotal: 100m, alreadyReconciled: 0m, amount: 60m);
    }

    [Fact]
    public void Validate_OverReconciliation_Throws()
    {
        var ex = Assert.Throws<OverReconciliationException>(() =>
            Validate(documentTotal: 100m, alreadyReconciled: 60m, amount: 50m));

        Assert.Equal(40m, ex.Outstanding);
        Assert.Equal(50m, ex.Amount);
    }

    [Fact]
    public void Validate_ExactRemainderAfterPartialReconciliation_Succeeds()
    {
        Validate(documentTotal: 100m, alreadyReconciled: 60m, amount: 40m);
    }

    [Fact]
    public void Validate_UnpostedDocument_Throws()
    {
        Assert.Throws<UnpostedReconciliationDocumentException>(() => Validate(documentIsPosted: false));
    }

    [Fact]
    public void Validate_UnpostedSettlementLine_Throws()
    {
        Assert.Throws<UnpostedSettlementLineException>(() => Validate(settlementLineIsPosted: false));
    }

    [Fact]
    public void Validate_AccountMismatch_Throws()
    {
        Assert.Throws<ReconciliationAccountMismatchException>(() => Validate(settlementLineAccountId: Guid.NewGuid()));
    }

    [Fact]
    public void Validate_PartnerMismatch_Throws()
    {
        Assert.Throws<ReconciliationPartnerMismatchException>(() => Validate(settlementLinePartnerId: Guid.NewGuid()));
    }

    [Fact]
    public void Validate_NonPositiveAmount_Throws()
    {
        Assert.Throws<ArgumentException>(() => Validate(amount: 0m));
    }

    [Fact]
    public void Validate_SecondReconciliationAgainstAnAlreadyFullyConsumedLine_Throws()
    {
        // Reproduces the double-spend: a 100 settlement line already fully reconciled against
        // Invoice A (documentTotal/alreadyReconciled are per-document, so a fresh Invoice B has no
        // document-level history) must still be rejected when reconciled against Invoice B too.
        var ex = Assert.Throws<SettlementLineOverConsumedException>(() => Validate(
            documentTotal: 100m,
            alreadyReconciled: 0m,
            amount: 100m,
            settlementLineAmount: 100m,
            alreadyReconciledForLine: 100m));

        Assert.Equal(100m, ex.LineAmount);
        Assert.Equal(200m, ex.AttemptedTotal);
    }

    [Fact]
    public void Validate_LegitimatePartialReconciliationAcrossMultipleDocumentsFromOneLine_Succeeds()
    {
        // A single 250 settlement line legitimately split 100/100/50 across three invoices — each
        // call only checks the running total against the LINE's own 250, not against any one
        // document, so the third (50) call must still succeed after 200 was already consumed.
        Validate(documentTotal: 100m, alreadyReconciled: 0m, amount: 50m, settlementLineAmount: 250m, alreadyReconciledForLine: 200m);
    }
}
