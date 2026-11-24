using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// A posted invoice's or bill's total, reconciled and outstanding amounts. Moved unchanged out of
// InvoicesController/BillsController (2026-11-24) so direct payments (PaymentApplier) measure a
// document's open amount exactly as the document pages show it.
public static class DocumentBalances
{
    public static async Task<DocumentBalanceResponse> ForInvoiceAsync(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer,
        Guid companyId, Guid invoiceId, Guid? journalEntryId, Pako.Domain.Invoicing.DocumentType documentType, Guid? partnerId = null)
    {
        // A1 (v2 release): SalesReturn posts through the same isCreditNote mechanics as
        // CreditNote (its own AR control line is Credit-sided, not Debit-sided like a normal
        // invoice/DebitNote/DownPayment) — same "own total, computed from its own control line"
        // fix this method already applies to CreditNote/DownPayment.
        var isSourceDocument = documentType is Pako.Domain.Invoicing.DocumentType.CreditNote or Pako.Domain.Invoicing.DocumentType.DownPayment or Pako.Domain.Invoicing.DocumentType.SalesReturn;
        var creditSidedControlLine = documentType is Pako.Domain.Invoicing.DocumentType.CreditNote or Pako.Domain.Invoicing.DocumentType.SalesReturn;

        var total = 0m;
        Guid? controlLineId = null;
        if (journalEntryId is { } jeId)
        {
            var receivableAccountId = await new PaymentRecorder(db, localizer).ReceivableAccountIdAsync(companyId, partnerId);

            if (isSourceDocument)
            {
                var controlLine = await db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == jeId && l.AccountId == receivableAccountId)
                    .Select(l => new { l.Id, l.Debit, l.Credit })
                    .FirstOrDefaultAsync();
                if (controlLine is not null)
                {
                    controlLineId = controlLine.Id;
                    total = creditSidedControlLine ? controlLine.Credit : controlLine.Debit;
                }
            }
            else
            {
                total = await db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == jeId && l.AccountId == receivableAccountId)
                    .SumAsync(l => l.Debit);
            }
        }

        // Source documents (CreditNote/SalesReturn/DownPayment) can be reconciled two ways:
        // (a) their control line used as a settlement line against another invoice (ApplyCreditNote)
        // (b) a cash refund reconciled directly against this document (RecordPayment)
        // Sum both patterns to get the full reconciled amount.
        var reconciledViaControlLine = isSourceDocument && controlLineId is { } lineId
            ? await ReconciliationCreator.SumReconciledForLineAsync(db, lineId)
            : 0m;
        var reconciledViaDocument = await db.Reconciliations.AsNoTracking()
            .Where(r => r.InvoiceId == invoiceId).SumAsync(r => r.Amount);
        var reconciled = isSourceDocument
            ? reconciledViaControlLine + reconciledViaDocument
            : reconciledViaDocument;

        // InPayment: sum of outstanding Payment records (2-step, awaiting bank rec) for this invoice
        var inPayment = await db.Payments.AsNoTracking()
            .Where(p => p.InvoiceId == invoiceId && p.State == Domain.Payments.PaymentState.Posted)
            .SumAsync(p => p.Amount);

        return new DocumentBalanceResponse(total, reconciled, total - reconciled, inPayment);
    }

    public static async Task<DocumentBalanceResponse> ForBillAsync(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer,
        Guid companyId, Guid billId, Guid? journalEntryId, Pako.Domain.Bills.DocumentType documentType, Guid? partnerId = null)
    {
        // A2 (v2 release): PurchaseReturn posts through the same isCreditNote mechanics as
        // CreditNote — its own AP control line is Debit-sided too, so it needs no separate
        // ternary the way Invoicing's CreditNote-vs-DownPayment split does.
        var isSourceDocument = documentType is Pako.Domain.Bills.DocumentType.CreditNote or Pako.Domain.Bills.DocumentType.PurchaseReturn;

        var total = 0m;
        Guid? controlLineId = null;
        if (journalEntryId is { } jeId)
        {
            var payableAccountId = await new PaymentRecorder(db, localizer).PayableAccountIdAsync(companyId, partnerId);

            if (isSourceDocument)
            {
                var controlLine = await db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == jeId && l.AccountId == payableAccountId)
                    .Select(l => new { l.Id, l.Debit })
                    .FirstOrDefaultAsync();
                if (controlLine is not null)
                {
                    controlLineId = controlLine.Id;
                    total = controlLine.Debit;
                }
            }
            else
            {
                total = await db.JournalEntryLines.AsNoTracking()
                    .Where(l => l.JournalEntryId == jeId && l.AccountId == payableAccountId)
                    .SumAsync(l => l.Credit);
            }
        }

        // Source documents (CreditNote/PurchaseReturn) can be reconciled two ways:
        // (a) their control line used as a settlement line against another bill (ApplyCreditNote)
        // (b) a cash refund reconciled directly against this document (RecordPayment)
        // Sum both patterns to get the full reconciled amount.
        var reconciledViaControlLine = isSourceDocument && controlLineId is { } lineId
            ? await ReconciliationCreator.SumReconciledForLineAsync(db, lineId)
            : 0m;
        var reconciledViaDocument = await db.Reconciliations.AsNoTracking()
            .Where(r => r.BillId == billId).SumAsync(r => r.Amount);
        var reconciled = isSourceDocument
            ? reconciledViaControlLine + reconciledViaDocument
            : reconciledViaDocument;

        // InPayment: sum of outstanding Payment records (2-step, awaiting bank rec) for this bill
        var inPayment = await db.Payments.AsNoTracking()
            .Where(p => p.BillId == billId && p.State == Domain.Payments.PaymentState.Posted)
            .SumAsync(p => p.Amount);

        return new DocumentBalanceResponse(total, reconciled, total - reconciled, inPayment);
    }
}
