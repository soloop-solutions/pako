using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Controllers;
using Pako.Domain.Bills;
using Pako.Domain.Companies;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payments;
using Pako.Domain.Reconciliation;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// "Record a payment" against one posted invoice or bill: the settlement entry (Outstanding or
// Cash/Bank against the partner's AR/AP control line), posted, then reconciled against the document.
// Shared by the invoice and bill record-payment endpoints (and their inline-payment-on-create branch)
// and the bank statement import, so a payment from a statement is posted exactly like one entered
// by hand.
//
// Two-step mode (Odoo-style): when the journal has OutstandingReceiptsAccountId /
// OutstandingPaymentsAccountId set, the settlement entry hits the Outstanding account instead of
// the bank account directly. A Payment record is created to track the clearing. Bank reconciliation
// later clears Outstanding to Bank via PaymentClearingService.
//
// One-step mode (legacy): when the journal's outstanding accounts are null (Cash journals, or older
// companies), the settlement entry hits the bank/cash account directly, same as before.
//
// The caller owns the transaction and the final SaveChanges. This does one intermediate SaveChanges
// after the settlement entry, because ReconciliationCreator reads the settlement line back from the
// database. Several payments can therefore run inside one transaction: each sees the reconciliations
// the previous ones saved.
public sealed class PaymentRecorder(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
{
    public readonly record struct Outcome(Reconciliation? Reconciliation, JournalEntry? Entry, Payment? Payment, string? Error, bool NotFound = false)
    {
        public bool Succeeded => Reconciliation is not null;
    }

    private static Outcome Failed(string error) => new(null, null, null, error);

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
        var direction = isCreditDocument ? PaymentDirection.Outbound : PaymentDirection.Inbound;
        var outcome = await PostAndReconcileAsync(company, cashOrBankAccountId, receivableAccountId, invoice.PartnerId,
            controlIsDebit: isCreditDocument, amount, date, reference, invoice.Id, null, direction, auditUserId);

        if (outcome.Succeeded && auditUserId is not null)
        {
            AuditController.Stage(db, company.Id, "Invoice", invoice.Id.ToString(),
                isCreditDocument ? "Refund" : "Payment", auditUserId,
                $"Amount: {amount}, Account: {cashOrBankAccountId}");
        }

        return outcome;
    }

    public async Task<Outcome> ForBillAsync(
        Company company, Bill bill, decimal amount, Guid cashOrBankAccountId, DateOnly date, string? createdByUserId = null)
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
        var direction = isCreditDocument ? PaymentDirection.Inbound : PaymentDirection.Outbound;
        return await PostAndReconcileAsync(company, cashOrBankAccountId, payableAccountId, bill.PartnerId,
            controlIsDebit: !isCreditDocument, amount, date, reference, null, bill.Id, direction, createdByUserId);
    }

    // Direct payment (2026-11-24): money received from a customer or paid to a vendor with no
    // document yet. The settlement entry is the same as for a document payment (Outstanding or
    // Cash/Bank against the partner's AR/AP control line), so the amount sits on the partner's
    // balance until PaymentApplier matches it to invoices or bills. A Payment is always created:
    // in one-step mode (Cash journal, or a journal without outstanding accounts) the money is
    // already on the cash/bank account, so it is created Reconciled with OutstandingAccountId equal
    // to DestinationAccountId (see Payment.IsDirectToCash).
    public async Task<(Payment? Payment, JournalEntryLine? ControlLine, string? Error)> ForPartnerAsync(
        Company company, PaymentDirection direction, Guid partnerId, decimal amount, Guid cashOrBankAccountId, DateOnly date,
        string? reference, string? createdByUserId)
    {
        var inbound = direction == PaymentDirection.Inbound;
        var controlAccountId = inbound
            ? await ReceivableAccountIdAsync(company.Id, partnerId)
            : await PayableAccountIdAsync(company.Id, partnerId);
        if (controlAccountId == Guid.Empty)
        {
            return (null, null, localizer[inbound ? "NoReceivableAccount" : "NoPayableAccount"].Value);
        }

        // Inbound: Dr Outstanding/Cash, Cr AR. Outbound: Dr AP, Cr Outstanding/Cash.
        var settlement = await PostSettlementAsync(company, cashOrBankAccountId, controlAccountId, partnerId,
            controlIsDebit: !inbound, amount, date, reference ?? "", controlFirst: !inbound, direction);
        if (settlement.Error is not null)
        {
            return (null, null, settlement.Error);
        }

        var payment = new Payment
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Direction = direction,
            PartnerId = partnerId,
            Amount = amount,
            Date = date,
            Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim(),
            JournalEntryId = settlement.Entry!.Id,
            DestinationAccountId = cashOrBankAccountId,
            OutstandingAccountId = settlement.OutstandingAccountId ?? cashOrBankAccountId,
            State = settlement.OutstandingAccountId is null ? PaymentState.Reconciled : PaymentState.Posted,
            CreatedByUserId = createdByUserId,
        };
        db.Payments.Add(payment);
        return (payment, settlement.ControlLine, null);
    }

    private readonly record struct Settlement(JournalEntry? Entry, JournalEntryLine? ControlLine, Guid? OutstandingAccountId, string? Error);

    private async Task<Outcome> PostAndReconcileAsync(
        Company company, Guid cashOrBankAccountId, Guid controlAccountId, Guid partnerId, bool controlIsDebit,
        decimal amount, DateOnly date, string reference, Guid? invoiceId, Guid? billId,
        PaymentDirection direction, string? createdByUserId)
    {
        // Same line order as before the extraction: counter first for invoices, control first for bills.
        var settlement = await PostSettlementAsync(company, cashOrBankAccountId, controlAccountId, partnerId, controlIsDebit,
            amount, date, reference, controlFirst: invoiceId is null, direction);
        if (settlement.Error is not null)
        {
            return Failed(settlement.Error);
        }

        var entry = settlement.Entry!;
        var controlLine = settlement.ControlLine!;
        var outstandingAccountId = settlement.OutstandingAccountId;
        var result = await ReconciliationCreator.TryCreateAsync(db, company.Id, invoiceId, billId, controlLine.Id, amount);

        // Create Payment record if 2-step mode
        Payment? payment = null;
        if (outstandingAccountId is not null)
        {
            payment = new Payment
            {
                Id = Guid.NewGuid(),
                CompanyId = company.Id,
                Direction = direction,
                PartnerId = partnerId,
                Amount = amount,
                Date = date,
                Reference = reference,
                JournalEntryId = entry.Id,
                DestinationAccountId = cashOrBankAccountId,
                OutstandingAccountId = outstandingAccountId.Value,
                InvoiceId = invoiceId,
                BillId = billId,
                State = PaymentState.Posted,
                CreatedByUserId = createdByUserId,
            };
            db.Payments.Add(payment);
        }

        return result.Status switch
        {
            ReconciliationCreationStatus.NotFound => new Outcome(null, null, null, null, NotFound: true),
            ReconciliationCreationStatus.ValidationFailed => Failed(result.Error ?? ""),
            _ => new Outcome(result.Reconciliation, entry, payment, null),
        };
    }

    // The settlement entry, posted and saved: the partner's control line against the Outstanding
    // account (two-step) or the cash/bank account itself (one-step).
    private async Task<Settlement> PostSettlementAsync(
        Company company, Guid cashOrBankAccountId, Guid controlAccountId, Guid partnerId, bool controlIsDebit,
        decimal amount, DateOnly date, string reference, bool controlFirst, PaymentDirection direction)
    {
        // B9: the Cash or Bank journal, whichever matches the account the money actually moved through.
        var subType = await db.Accounts.AsNoTracking()
            .Where(a => a.Id == cashOrBankAccountId).Select(a => a.AccountSubType).FirstOrDefaultAsync();
        var journal = await JournalResolver.GetAsync(db, company.Id, JournalResolver.SettlementJournalType(subType));
        if (journal is null)
        {
            return new Settlement(null, null, null, localizer["NoJournalToPost"].Value);
        }

        // Two-step mode: use the outstanding account if the journal has one configured.
        // Inbound (customer pays us) → OutstandingReceiptsAccountId
        // Outbound (we pay vendor) → OutstandingPaymentsAccountId
        var outstandingAccountId = direction == PaymentDirection.Inbound
            ? journal.OutstandingReceiptsAccountId
            : journal.OutstandingPaymentsAccountId;

        // The counter-account: Outstanding if 2-step, or the actual Cash/Bank if 1-step.
        var counterAccountId = outstandingAccountId ?? cashOrBankAccountId;

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
        var counterLine = new JournalEntryLine
        {
            Id = Guid.NewGuid(), AccountId = counterAccountId,
            Debit = controlIsDebit ? 0m : amount,
            Credit = controlIsDebit ? amount : 0m,
        };
        if (controlFirst)
        {
            entry.Lines.Add(controlLine);
            entry.Lines.Add(counterLine);
        }
        else
        {
            entry.Lines.Add(counterLine);
            entry.Lines.Add(controlLine);
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
            return new Settlement(null, null, null, ex.Message);
        }

        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();
        return new Settlement(entry, controlLine, outstandingAccountId, null);
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
