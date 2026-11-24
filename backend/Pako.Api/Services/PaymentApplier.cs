using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;
using Pako.Api.Contracts;
using Pako.Domain.Bills;
using Pako.Domain.Invoicing;
using Pako.Domain.Ledger;
using Pako.Domain.Payments;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// Direct payments (2026-11-24): applies a payment's open amount to the partner's posted invoices
// (money received) or bills (money paid). Each allocation is a Reconciliation of the payment's
// control line (its AR/AP line) against the document, through ReconciliationCreator, so the same
// partner, account and over-reconciliation checks as "Record payment" apply. A payment received
// applies to invoices, debit notes and down-payment invoices; one paid applies to bills. Credit
// documents (credit notes, returns) are refused: their own control line is on the same side.
//
// The caller owns the transaction. Each allocation is saved before the next, because
// ReconciliationCreator reads earlier reconciliations back from the database.
public sealed class PaymentApplier(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
{
    public const int OpenDocumentLimit = 200;

    private static readonly Pako.Domain.Invoicing.DocumentType[] PayableInvoiceTypes =
        [Pako.Domain.Invoicing.DocumentType.Invoice, Pako.Domain.Invoicing.DocumentType.DebitNote, Pako.Domain.Invoicing.DocumentType.DownPayment];

    /// <summary>The payment's line on the partner's receivable/payable account.</summary>
    public Task<JournalEntryLine?> ControlLineAsync(Payment payment) =>
        db.JournalEntryLines.AsNoTracking()
            .Where(l => l.JournalEntryId == payment.JournalEntryId && l.PartnerId == payment.PartnerId && l.AccountId != payment.OutstandingAccountId)
            .OrderBy(l => l.Id)
            .FirstOrDefaultAsync();

    /// <summary>
    /// The amount of each payment not yet applied to a document (0 for a cancelled payment), and
    /// how many documents it has been applied to.
    /// </summary>
    public async Task<Dictionary<Guid, (decimal Unapplied, int AppliedCount)>> UnappliedAsync(IReadOnlyCollection<Payment> payments)
    {
        var entryIds = payments.Select(p => p.JournalEntryId).Distinct().ToList();
        var lines = await db.JournalEntryLines.AsNoTracking()
            .Where(l => entryIds.Contains(l.JournalEntryId) && l.PartnerId != null)
            .Select(l => new { l.Id, l.JournalEntryId, l.AccountId, l.PartnerId, l.Debit, l.Credit })
            .ToListAsync();
        var lineIds = lines.Select(l => l.Id).ToList();
        var applied = await db.Reconciliations.AsNoTracking()
            .Where(r => lineIds.Contains(r.JournalEntryLineId))
            .GroupBy(r => r.JournalEntryLineId)
            .Select(g => new { LineId = g.Key, Amount = g.Sum(r => r.Amount), Count = g.Count() })
            .ToDictionaryAsync(x => x.LineId);

        var result = new Dictionary<Guid, (decimal, int)>();
        foreach (var payment in payments)
        {
            var line = lines.FirstOrDefault(l => l.JournalEntryId == payment.JournalEntryId && l.PartnerId == payment.PartnerId
                && l.AccountId != payment.OutstandingAccountId);
            if (line is null)
            {
                result[payment.Id] = (0m, 0);
                continue;
            }

            var done = applied.GetValueOrDefault(line.Id);
            var lineAmount = line.Debit + line.Credit;
            var unapplied = payment.State == PaymentState.Cancelled ? 0m : Math.Max(lineAmount - (done?.Amount ?? 0m), 0m);
            result[payment.Id] = (unapplied, done?.Count ?? 0);
        }

        return result;
    }

    /// <summary>
    /// The partner's posted documents a payment in this direction can apply to, with what each
    /// still owes, oldest due date first. With an amount, Suggested fills them in that order.
    /// </summary>
    public async Task<List<OpenDocumentResponse>> OpenDocumentsAsync(Guid companyId, Guid partnerId, PaymentDirection direction, decimal? amount)
    {
        var open = new List<OpenDocumentResponse>();
        if (direction == PaymentDirection.Inbound)
        {
            var invoices = await db.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && i.PartnerId == partnerId && i.State == InvoiceState.Posted
                    && PayableInvoiceTypes.Contains(i.DocumentType))
                .OrderBy(i => i.DueDate).ThenBy(i => i.IssueDate).ThenBy(i => i.InvoiceNumber)
                .Take(OpenDocumentLimit)
                .ToListAsync();
            foreach (var invoice in invoices)
            {
                var balance = await DocumentBalances.ForInvoiceAsync(db, localizer, companyId, invoice.Id, invoice.JournalEntryId,
                    invoice.DocumentType, invoice.PartnerId);
                if (balance.Outstanding > 0)
                {
                    open.Add(new OpenDocumentResponse(invoice.Id, "Invoice", invoice.DocumentType.ToString(), invoice.InvoiceNumber,
                        invoice.IssueDate, invoice.DueDate, balance.Total, balance.Outstanding, 0m));
                }
            }
        }
        else
        {
            var bills = await db.Bills.AsNoTracking()
                .Where(b => b.CompanyId == companyId && b.PartnerId == partnerId && b.State == BillState.Posted
                    && b.DocumentType == Pako.Domain.Bills.DocumentType.Bill)
                .OrderBy(b => b.DueDate).ThenBy(b => b.IssueDate).ThenBy(b => b.CreatedAt)
                .Take(OpenDocumentLimit)
                .ToListAsync();
            foreach (var bill in bills)
            {
                var balance = await DocumentBalances.ForBillAsync(db, localizer, companyId, bill.Id, bill.JournalEntryId,
                    bill.DocumentType, bill.PartnerId);
                if (balance.Outstanding > 0)
                {
                    open.Add(new OpenDocumentResponse(bill.Id, "Bill", bill.DocumentType.ToString(), bill.VendorReference,
                        bill.IssueDate, bill.DueDate, balance.Total, balance.Outstanding, 0m));
                }
            }
        }

        if (amount is not { } left || left <= 0)
        {
            return open;
        }

        for (var i = 0; i < open.Count && left > 0; i++)
        {
            var take = Math.Min(left, open[i].Outstanding);
            open[i] = open[i] with { Suggested = take };
            left -= take;
        }

        return open;
    }

    /// <summary>
    /// Applies the payment to the given documents, all or nothing (the caller rolls back on an
    /// error). Returns the error message, or null when every allocation was applied.
    /// </summary>
    public async Task<string?> ApplyAsync(Guid companyId, Payment payment, IReadOnlyList<PaymentAllocationRequest> allocations)
    {
        if (allocations.Count == 0)
        {
            return null;
        }

        if (payment.State == PaymentState.Cancelled)
        {
            return localizer["PaymentAlreadyCancelled"].Value;
        }

        if (allocations.Any(a => a.Amount <= 0))
        {
            return localizer["AmountMustBePositive"].Value;
        }

        if (allocations.Any(a => (a.InvoiceId is null) == (a.BillId is null))
            || allocations.GroupBy(a => a.InvoiceId ?? a.BillId).Any(g => g.Count() > 1))
        {
            return localizer["PaymentAllocationInvalid"].Value;
        }

        var inbound = payment.Direction == PaymentDirection.Inbound;
        if (allocations.Any(a => inbound ? a.InvoiceId is null : a.BillId is null))
        {
            return localizer["PaymentAllocationWrongDocument"].Value;
        }

        var controlLine = await ControlLineAsync(payment);
        if (controlLine is null)
        {
            return localizer["PaymentAllocationInvalid"].Value;
        }

        var unapplied = (await UnappliedAsync([payment]))[payment.Id].Unapplied;
        if (allocations.Sum(a => a.Amount) > unapplied)
        {
            return string.Format(localizer["PaymentAllocationExceedsUnapplied"].Value, unapplied.ToString("N2"));
        }

        foreach (var allocation in allocations)
        {
            var error = inbound
                ? await CheckInvoiceAsync(companyId, payment, allocation.InvoiceId!.Value, allocation.Amount)
                : await CheckBillAsync(companyId, payment, allocation.BillId!.Value, allocation.Amount);
            if (error is not null)
            {
                return error;
            }

            var result = await ReconciliationCreator.TryCreateAsync(db, companyId, allocation.InvoiceId, allocation.BillId,
                controlLine.Id, allocation.Amount);
            if (result.Status != ReconciliationCreationStatus.Success)
            {
                return result.Error ?? localizer["PaymentAllocationWrongDocument"].Value;
            }

            await db.SaveChangesAsync();
        }

        return null;
    }

    private async Task<string?> CheckInvoiceAsync(Guid companyId, Payment payment, Guid invoiceId, decimal amount)
    {
        var invoice = await db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == invoiceId && i.CompanyId == companyId);
        if (invoice is null || invoice.PartnerId != payment.PartnerId || invoice.State != InvoiceState.Posted
            || !PayableInvoiceTypes.Contains(invoice.DocumentType))
        {
            return localizer["PaymentAllocationWrongDocument"].Value;
        }

        var balance = await DocumentBalances.ForInvoiceAsync(db, localizer, companyId, invoice.Id, invoice.JournalEntryId,
            invoice.DocumentType, invoice.PartnerId);
        return amount > balance.Outstanding
            ? string.Format(localizer["PaymentAllocationExceedsOutstanding"].Value, invoice.InvoiceNumber, balance.Outstanding.ToString("N2"))
            : null;
    }

    private async Task<string?> CheckBillAsync(Guid companyId, Payment payment, Guid billId, decimal amount)
    {
        var bill = await db.Bills.AsNoTracking().FirstOrDefaultAsync(b => b.Id == billId && b.CompanyId == companyId);
        if (bill is null || bill.PartnerId != payment.PartnerId || bill.State != BillState.Posted
            || bill.DocumentType != Pako.Domain.Bills.DocumentType.Bill)
        {
            return localizer["PaymentAllocationWrongDocument"].Value;
        }

        var balance = await DocumentBalances.ForBillAsync(db, localizer, companyId, bill.Id, bill.JournalEntryId,
            bill.DocumentType, bill.PartnerId);
        return amount > balance.Outstanding
            ? string.Format(localizer["PaymentAllocationExceedsOutstanding"].Value, bill.VendorReference, balance.Outstanding.ToString("N2"))
            : null;
    }
}
