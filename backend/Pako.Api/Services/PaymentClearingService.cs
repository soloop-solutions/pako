using Microsoft.Extensions.Localization;
using Pako.Domain.Companies;
using Pako.Domain.Ledger;
using Pako.Domain.Payments;
using Pako.Infrastructure;

namespace Pako.Api.Services;

// Clears an outstanding Payment to the actual bank account. Called during bank reconciliation when
// a bank statement line is matched to a Payment record (2-step mode).
//
// Creates a 2-line clearing JE:
//   Inbound (customer receipt):  Dr Bank / Cr Outstanding Receipts
//   Outbound (vendor payment):   Dr Outstanding Payments / Cr Bank
//
// Then updates the Payment to Reconciled and stores the clearing JE id.
public sealed class PaymentClearingService(PakoDbContext db, IStringLocalizer<ErrorMessages> localizer)
{
    public readonly record struct ClearingOutcome(JournalEntry? Entry, string? Error)
    {
        public bool Succeeded => Entry is not null;
    }

    public async Task<ClearingOutcome> ClearAsync(Company company, Payment payment, DateOnly date)
    {
        if (payment.State != PaymentState.Posted)
        {
            return new ClearingOutcome(null, localizer["PaymentNotOutstanding"].Value);
        }

        var journal = await JournalResolver.GetAsync(db, company.Id, JournalType.Bank);
        if (journal is null)
        {
            return new ClearingOutcome(null, localizer["NoJournalToPost"].Value);
        }

        var isInbound = payment.Direction == PaymentDirection.Inbound;

        var entry = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            JournalId = journal.Id,
            Date = date,
            Reference = $"Bank clearing: {payment.Reference}",
        };

        // Inbound (receipt): Dr Bank / Cr Outstanding Receipts
        // Outbound (payment): Dr Outstanding Payments / Cr Bank
        var bankLine = new JournalEntryLine
        {
            Id = Guid.NewGuid(),
            AccountId = payment.DestinationAccountId,
            Debit = isInbound ? payment.Amount : 0m,
            Credit = isInbound ? 0m : payment.Amount,
        };
        var outstandingLine = new JournalEntryLine
        {
            Id = Guid.NewGuid(),
            AccountId = payment.OutstandingAccountId,
            Debit = isInbound ? 0m : payment.Amount,
            Credit = isInbound ? payment.Amount : 0m,
        };

        entry.Lines.Add(bankLine);
        entry.Lines.Add(outstandingLine);

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
            return new ClearingOutcome(null, ex.Message);
        }

        db.JournalEntries.Add(entry);

        payment.State = PaymentState.Reconciled;
        payment.ClearingJournalEntryId = entry.Id;

        return new ClearingOutcome(entry, null);
    }
}
