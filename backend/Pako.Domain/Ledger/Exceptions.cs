namespace Pako.Domain.Ledger;

public class UnbalancedJournalEntryException : Exception
{
    public Guid JournalEntryId { get; }
    public decimal TotalDebit { get; }
    public decimal TotalCredit { get; }

    public UnbalancedJournalEntryException(Guid journalEntryId, decimal totalDebit, decimal totalCredit)
        : base($"Journal entry {journalEntryId} is unbalanced: debit {totalDebit} != credit {totalCredit}.")
    {
        JournalEntryId = journalEntryId;
        TotalDebit = totalDebit;
        TotalCredit = totalCredit;
    }
}

public class AccountingLockDateViolationException : Exception
{
    public Guid JournalEntryId { get; }
    public DateOnly EntryDate { get; }
    public DateOnly LockDate { get; }

    public AccountingLockDateViolationException(Guid journalEntryId, DateOnly entryDate, DateOnly lockDate)
        : base($"Journal entry {journalEntryId} dated {entryDate} is on or before the company's accounting lock date {lockDate}.")
    {
        JournalEntryId = journalEntryId;
        EntryDate = entryDate;
        LockDate = lockDate;
    }
}

public class TaxLockDateViolationException : Exception
{
    public Guid JournalEntryId { get; }
    public DateOnly EntryDate { get; }
    public DateOnly LockDate { get; }

    public TaxLockDateViolationException(Guid journalEntryId, DateOnly entryDate, DateOnly lockDate)
        : base($"Journal entry {journalEntryId} dated {entryDate} is on or before the company's tax lock date {lockDate}.")
    {
        JournalEntryId = journalEntryId;
        EntryDate = entryDate;
        LockDate = lockDate;
    }
}

public class PostedJournalEntryImmutableException : Exception
{
    public Guid JournalEntryId { get; }

    public PostedJournalEntryImmutableException(Guid journalEntryId)
        : base($"Journal entry {journalEntryId} is Posted and cannot be modified or deleted; create a reversing entry instead.")
    {
        JournalEntryId = journalEntryId;
    }
}
