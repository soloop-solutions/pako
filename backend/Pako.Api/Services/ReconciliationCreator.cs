using Microsoft.EntityFrameworkCore;
using Pako.Domain.Bills;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;
using Pako.Infrastructure;

namespace Pako.Api.Services;

public enum ReconciliationCreationStatus
{
    Success,
    NotFound,
    ValidationFailed
}

public record ReconciliationCreationResult(
    ReconciliationCreationStatus Status,
    Reconciliation? Reconciliation = null,
    string? Error = null);

// Shared by ReconciliationsController.Create and the atomic invoice/bill record-payment endpoints
// so both go through the exact same double-spend check (Fix: ReconciliationValidator now also
// caps the total reconciled against a single JournalEntryLine at that line's own amount, not just
// the document's outstanding balance). Callers own the transaction/row-lock around this call —
// see DatabaseFacadeExtensions.SupportsRowLocking — this only does the lookups, validation, and
// staging the Reconciliation + JournalEntryLine.ReconciledFlag update on the tracked context; the
// caller still has to SaveChangesAsync.
public static class ReconciliationCreator
{
    public static async Task<ReconciliationCreationResult> TryCreateAsync(
        PakoDbContext db, Guid companyId, Guid? invoiceId, Guid? billId, Guid journalEntryLineId, decimal amount)
    {
        var settlementLine = await db.JournalEntryLines
            .Include(l => l.JournalEntry)
            .FirstOrDefaultAsync(l => l.Id == journalEntryLineId);
        if (settlementLine?.JournalEntry is null || settlementLine.JournalEntry.CompanyId != companyId)
        {
            return new ReconciliationCreationResult(
                ReconciliationCreationStatus.ValidationFailed,
                Error: "Invalid settlement journal entry line for this company.");
        }

        var defaults = await db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);

        Guid documentId;
        Guid documentPartnerId;
        Guid? documentJournalEntryId;
        bool documentIsPosted;
        Guid controlAccountId;

        if (invoiceId is { } invId)
        {
            var invoice = await db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == invId && i.CompanyId == companyId);
            if (invoice is null)
            {
                return new ReconciliationCreationResult(ReconciliationCreationStatus.NotFound);
            }

            documentId = invoice.Id;
            documentPartnerId = invoice.PartnerId;
            documentJournalEntryId = invoice.JournalEntryId;
            documentIsPosted = invoice.State == InvoiceState.Posted;
            controlAccountId = defaults?.ReceivableAccountId ?? Guid.Empty;
        }
        else
        {
            var bill = await db.Bills.AsNoTracking().FirstOrDefaultAsync(b => b.Id == billId && b.CompanyId == companyId);
            if (bill is null)
            {
                return new ReconciliationCreationResult(ReconciliationCreationStatus.NotFound);
            }

            documentId = bill.Id;
            documentPartnerId = bill.PartnerId;
            documentJournalEntryId = bill.JournalEntryId;
            documentIsPosted = bill.State == BillState.Posted;
            controlAccountId = defaults?.PayableAccountId ?? Guid.Empty;
        }

        var documentTotal = 0m;
        if (documentJournalEntryId is { } journalEntryId)
        {
            documentTotal = await db.JournalEntryLines.AsNoTracking()
                .Where(l => l.JournalEntryId == journalEntryId && l.AccountId == controlAccountId)
                .SumAsync(l => l.Debit + l.Credit);
        }

        var alreadyReconciled = await db.Reconciliations.AsNoTracking()
            .Where(r => (invoiceId != null && r.InvoiceId == invoiceId) || (billId != null && r.BillId == billId))
            .SumAsync(r => r.Amount);

        var alreadyReconciledForLine = await SumReconciledForLineAsync(db, journalEntryLineId);

        var settlementLineAmount = settlementLine.Debit != 0 ? settlementLine.Debit : settlementLine.Credit;

        try
        {
            ReconciliationValidator.Validate(
                journalEntryLineId,
                settlementLine.JournalEntry.State == JournalEntryState.Posted,
                settlementLine.AccountId,
                controlAccountId,
                settlementLine.PartnerId,
                documentId,
                documentIsPosted,
                documentPartnerId,
                documentTotal,
                alreadyReconciled,
                amount,
                settlementLineAmount,
                alreadyReconciledForLine);
        }
        catch (Exception ex) when (
            ex is ArgumentException or
            UnpostedSettlementLineException or
            UnpostedReconciliationDocumentException or
            ReconciliationAccountMismatchException or
            ReconciliationPartnerMismatchException or
            OverReconciliationException or
            SettlementLineOverConsumedException)
        {
            return new ReconciliationCreationResult(ReconciliationCreationStatus.ValidationFailed, Error: ex.Message);
        }

        var reconciliation = invoiceId is { } iid
            ? Reconciliation.ForInvoice(companyId, iid, journalEntryLineId, amount)
            : Reconciliation.ForBill(companyId, billId!.Value, journalEntryLineId, amount);

        db.Reconciliations.Add(reconciliation);

        if (alreadyReconciledForLine + amount >= settlementLineAmount)
        {
            settlementLine.ReconciledFlag = true;
            settlementLine.ReconciliationId = reconciliation.Id;
        }

        return new ReconciliationCreationResult(ReconciliationCreationStatus.Success, reconciliation);
    }

    public static Task<decimal> SumReconciledForLineAsync(PakoDbContext db, Guid journalEntryLineId) =>
        db.Reconciliations.AsNoTracking()
            .Where(r => r.JournalEntryLineId == journalEntryLineId)
            .SumAsync(r => r.Amount);
}
