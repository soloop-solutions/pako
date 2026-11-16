using Pako.Domain.Companies;

namespace Pako.Domain.Ledger;

public enum JournalEntryState
{
    Draft,
    Posted,
    Cancelled
}

[Pako.Domain.Shared.Audited]
public class JournalEntry
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid JournalId { get; set; }
    public DateOnly Date { get; set; }
    public string? Description { get; set; }
    public string? Reference { get; set; }
    public string? Remarks { get; set; }
    public JournalEntryState State { get; set; } = JournalEntryState.Draft;
    public string? SequenceNumber { get; set; }
    public DateTime? PostedAtUtc { get; set; }

    [Pako.Domain.Shared.AuditIgnore]
    public string? EntryHash { get; set; }
    [Pako.Domain.Shared.AuditIgnore]
    public string? PrevHash { get; set; }
    [Pako.Domain.Shared.AuditIgnore]
    public long? SecureSequenceNumber { get; set; }

    // R28: user id, timestamp, source document id and IP of posting. PostedFromIp is stamped by the
    // audit capture on the first posting save when the request carries an IP; PostedByUserId is set
    // by the controllers of the 4 primary posting actions, not yet by the secondary settlement entries.
    public Guid? PostedByUserId { get; set; }
    public string? PostedFromIp { get; set; }
    public Guid? SourceDocumentId { get; set; }

    // CFA-002: PostgreSQL xmin-based optimistic concurrency token.
    public uint RowVersion { get; set; }

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

        // B4: HardLockDate is never resolved through AccountLockResolver — company here is always
        // the real, unexempted value for this field, by construction.
        if (company.HardLockDate is { } hardLockDate && Date <= hardLockDate)
        {
            throw new HardLockDateViolationException(Id, Date, hardLockDate);
        }

        // R31: amounts must be non-negative — corrections use the opposite side (debit/credit), not
        // signed values. Checked before R30 so a line with Debit=-100 gets a clear "negative" message
        // rather than silently passing the dual-amount check.
        foreach (var line in Lines)
        {
            if (line.Debit < 0 || line.Credit < 0)
            {
                throw new NegativeAmountLineException(line.Id);
            }
        }

        // R30: each line posts to one side only — positive Debit or positive Credit, never both.
        foreach (var line in Lines)
        {
            if (line.Debit > 0 && line.Credit > 0)
            {
                throw new DualAmountLineException(line.Id);
            }
        }

        // R19: OriginalCurrency/OriginalAmount/ExchangeRate must all be set together, or none of
        // them — a partial set can't be reconciled back to the functional-currency Debit/Credit.
        foreach (var line in Lines)
        {
            var fieldsSet = (line.OriginalCurrency is not null ? 1 : 0) +
                             (line.OriginalAmount is not null ? 1 : 0) +
                             (line.ExchangeRate is not null ? 1 : 0);
            if (fieldsSet is not (0 or 3))
            {
                throw new InconsistentForeignCurrencyDataException(line.Id);
            }
        }

        State = JournalEntryState.Posted;
        PostedAtUtc = DateTime.UtcNow;
    }

    // R16: journal entries are immutable once posted — corrections are storno (reversing)
    // entries only. Builds a mirror entry with every line's Debit/Credit swapped, already
    // Posted (a storno document is created final, not Draft-then-posted-separately), and marks
    // this entry Cancelled. PakoDbContext.ValidateImmutability carves out exactly this one
    // Posted -> Cancelled transition, the same way it already carves out ReconciledFlag updates.
    public JournalEntry Reverse(Company company, DateOnly date, string? reference = null)
    {
        if (State != JournalEntryState.Posted)
        {
            throw new InvalidOperationException($"Journal entry {Id} cannot be reversed from state {State}; only Posted entries can be reversed.");
        }

        var reversal = new JournalEntry
        {
            Id = Guid.NewGuid(),
            CompanyId = CompanyId,
            JournalId = JournalId,
            Date = date,
            Description = Description,
            Reference = reference ?? $"Reversal of {Reference ?? Id.ToString()}",
            Remarks = Remarks,
            Lines = Lines.Select(l => new JournalEntryLine
            {
                Id = Guid.NewGuid(),
                AccountId = l.AccountId,
                PartnerId = l.PartnerId,
                Debit = l.Credit,
                Credit = l.Debit,
                Description = l.Description,
                TaxId = l.TaxId,
                ProjectId = l.ProjectId,
                EmployeeId = l.EmployeeId,
                AnalyticDistribution = l.AnalyticDistribution is null ? null : new Dictionary<Guid, decimal>(l.AnalyticDistribution),
                OriginalCurrency = l.OriginalCurrency,
                OriginalAmount = l.OriginalAmount,
                ExchangeRate = l.ExchangeRate
            }).ToList()
        };

        reversal.Post(company);
        State = JournalEntryState.Cancelled;

        return reversal;
    }
}
