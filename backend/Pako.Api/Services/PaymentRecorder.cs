using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Controllers;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Reconciliation;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// "Record a payment" against one posted invoice or bill: the settlement entry (Cash/Bank against the
// partner's AR/AP control line), posted, then reconciled against the document. Shared by the invoice
// and bill record-payment endpoints (and their inline-payment-on-create branch) and the bank statement
// import, so a payment from a statement is posted exactly like one entered by hand.
//
// The caller owns the transaction and the final SaveChanges. This does one intermediate SaveChanges
// after the settlement entry, because ReconciliationCreator reads the settlement line back from the
// database. Several payments can therefore run inside one transaction: each sees the reconciliations
// the previous ones saved.
public sealed class PaymentRecorder(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
{
    public readonly record struct Outcome(Reconciliation? Reconciliation, JournalEntry? Entry, string? Error, bool NotFound = false)
    {
        public bool Succeeded => Reconciliation is not null;
    }

    private static Outcome Failed(string error) => new(null, null, error);

    // auditUserId: when given, stages the semantic "Payment"/"Refund" audit event on the invoice (the
    // invoice endpoints always did; bills never did, and that is kept as it was).
    public async Task<Outcome> ForInvoiceAsync(
        Company company, Invoice invoice, decimal amount, Guid cashOrBankAccountId, DateOnly date, string? auditUserId = null)
    {
        var receivableAccountId = await ReceivableAccountIdAsync(company.Id, invoice.PartnerId);
        if (receivableAccountId == Guid.Empty)
        {
            return Failed(localizer["NoReceivableAccount"].Value);
        }

        // A Sales Return or Credit Note is a credit document: "paying" it is a refund, cash goes OUT
        // (Credit Cash) and the customer's credit balance is cleared (Debit AR). Normal invoices are the
        // reverse: cash IN (Debit Cash), receivable cleared (Credit AR).
        var isCreditDocument = invoice.DocumentType is Pako.Domain.Invoicing.DocumentType.CreditNote or Pako.Domain.Invoicing.DocumentType.SalesReturn;
        var reference = isCreditDocument ? $"Refund for {invoice.InvoiceNumber}" : $"Payment for {invoice.InvoiceNumber}";
        var outcome = await PostAndReconcileAsync(company, cashOrBankAccountId, receivableAccountId, invoice.PartnerId,
            controlIsDebit: isCreditDocument, amount, date, reference, invoice.Id, null);

        if (outcome.Succeeded && auditUserId is not null)
        {
            AuditController.Stage(db, company.Id, "Invoice", invoice.Id.ToString(),
                isCreditDocument ? "Refund" : "Payment", auditUserId,
                $"Amount: {amount}, Account: {cashOrBankAccountId}");
        }

        return outcome;
    }

    public async Task<Outcome> ForBillAsync(
        Company company, Bill bill, decimal amount, Guid cashOrBankAccountId, DateOnly date)
    {
        var payableAccountId = await PayableAccountIdAsync(company.Id, bill.PartnerId);
        if (payableAccountId == Guid.Empty)
        {
            return Failed(localizer["NoPayableAccount"].Value);
        }

        // A Purchase Return or Credit Note is a credit document: "paying" it means receiving a refund,
        // cash comes IN (Debit Cash) and the supplier's credit balance is cleared (Credit AP). Normal
        // bills are the reverse: cash OUT (Credit Cash), payable cleared (Debit AP).
        var isCreditDocument = bill.DocumentType is Pako.Domain.Bills.DocumentType.CreditNote or Pako.Domain.Bills.DocumentType.PurchaseReturn;
        var reference = isCreditDocument ? $"Refund for {bill.VendorReference}" : $"Payment for {bill.VendorReference}";
        return await PostAndReconcileAsync(company, cashOrBankAccountId, payableAccountId, bill.PartnerId,
            controlIsDebit: !isCreditDocument, amount, date, reference, null, bill.Id);
    }

    private async Task<Outcome> PostAndReconcileAsync(
        Company company, Guid cashOrBankAccountId, Guid controlAccountId, Guid partnerId, bool controlIsDebit,
        decimal amount, DateOnly date, string reference, Guid? invoiceId, Guid? billId)
    {
        // B9: the Cash or Bank journal, whichever matches the account the money actually moved through.
        var subType = await db.Accounts.AsNoTracking()
            .Where(a => a.Id == cashOrBankAccountId).Select(a => a.AccountSubType).FirstOrDefaultAsync();
        var journal = await JournalResolver.GetAsync(db, company.Id, JournalResolver.SettlementJournalType(subType));
        if (journal is null)
        {
            return Failed(localizer["NoJournalToPost"].Value);
        }

        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = journal.Id,
            Date = date,
            Reference = reference,
        };
        var controlLine = new JournalEntryLine
        {
            Id = Guid.NewGuid(), AccountId = controlAccountId, PartnerId = partnerId,
            Debit = controlIsDebit ? amount : 0m,
            Credit = controlIsDebit ? 0m : amount,
        };
        var cashLine = new JournalEntryLine
        {
            Id = Guid.NewGuid(), AccountId = cashOrBankAccountId,
            Debit = controlIsDebit ? 0m : amount,
            Credit = controlIsDebit ? amount : 0m,
        };
        // Same line order as before the extraction: cash first for invoices, control first for bills.
        if (invoiceId is not null)
        {
            entry.Lines.Add(cashLine);
            entry.Lines.Add(controlLine);
        }
        else
        {
            entry.Lines.Add(controlLine);
            entry.Lines.Add(cashLine);
        }

        try
        {
            entry.Post(company);
        }
        catch (Exception ex) when (
            ex is InvalidOperationException or
            UnbalancedJournalEntryException or
            AccountingLockDateViolationException or
            TaxLockDateViolationException or
            HardLockDateViolationException)
        {
            return Failed(ex.Message);
        }

        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();

        var result = await ReconciliationCreator.TryCreateAsync(db, company.Id, invoiceId, billId, controlLine.Id, amount);
        return result.Status switch
        {
            ReconciliationCreationStatus.NotFound => new Outcome(null, null, null, NotFound: true),
            ReconciliationCreationStatus.ValidationFailed => Failed(result.Error ?? ""),
            _ => new Outcome(result.Reconciliation, entry, null),
        };
    }

    // B8: the partner's own ReceivableAccountId wins when set; the company's default otherwise.
    public async Task<Guid> ReceivableAccountIdAsync(Guid companyId, Guid? partnerId = null)
    {
        if (partnerId is { } id)
        {
            var own = await db.Partners.AsNoTracking()
                .Where(p => p.Id == id && p.CompanyId == companyId)
                .Select(p => p.ReceivableAccountId)
                .FirstOrDefaultAsync();
            if (own is { } accountId) return accountId;
        }

        return (await DefaultsAsync(companyId))?.ReceivableAccountId ?? Guid.Empty;
    }

    // B8: the partner's own PayableAccountId wins when set; the company's default otherwise.
    public async Task<Guid> PayableAccountIdAsync(Guid companyId, Guid? partnerId = null)
    {
        if (partnerId is { } id)
        {
            var own = await db.Partners.AsNoTracking()
                .Where(p => p.Id == id && p.CompanyId == companyId)
                .Select(p => p.PayableAccountId)
                .FirstOrDefaultAsync();
            if (own is { } accountId) return accountId;
        }

        return (await DefaultsAsync(companyId))?.PayableAccountId ?? Guid.Empty;
    }

    private Task<CompanyAccountDefaults?> DefaultsAsync(Guid companyId) =>
        db.CompanyAccountDefaults.AsNoTracking().FirstOrDefaultAsync(d => d.CompanyId == companyId);
}
