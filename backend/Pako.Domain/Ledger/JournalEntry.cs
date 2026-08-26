using Pako.Domain.Companies;

namespace Pako.Domain.Ledger;

public enum JournalEntryState
{
    Draft,
    Posted,
    Cancelled
}

public class JournalEntry
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid JournalId { get; set; }
    public DateOnly Date { get; set; }
    public string? Reference { get; set; }
    public JournalEntryState State { get; set; } = JournalEntryState.Draft;
    public string? SequenceNumber { get; set; }
    public DateTime? PostedAtUtc { get; set; }

    public string? EntryHash { get; set; }
    public string? PrevHash { get; set; }
    public long? SecureSequenceNumber { get; set; }

    public List<JournalEntryLine> Lines { get; set; } = new();

    public void Post(Company company)
    {
        if (State != JournalEntryState.Draft)
        {
            throw new InvalidOperationException(
                $"Journal entry {Id} cannot be posted from state {State}; only Draft entries can be posted.");
        }

        if (Lines.Count == 0)
        {
            throw new InvalidOperationException($"Journal entry {Id} has no lines.");
        }

        var totalDebit = Lines.Sum(l => l.Debit);
        var totalCredit = Lines.Sum(l => l.Credit);
        if (totalDebit != totalCredit)
        {
            throw new UnbalancedJournalEntryException(Id, totalDebit, totalCredit);
        }

        if (company.AccountingLockDate is { } accountingLockDate && Date <= accountingLockDate)
        {
            throw new AccountingLockDateViolationException(Id, Date, accountingLockDate);
        }

        if (company.TaxLockDate is { } taxLockDate && Date <= taxLockDate && Lines.Any(l => l.TaxId.HasValue))
        {
            throw new TaxLockDateViolationException(Id, Date, taxLockDate);
        }

        State = JournalEntryState.Posted;
        PostedAtUtc = DateTime.UtcNow;
    }
}
