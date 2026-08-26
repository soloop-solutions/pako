namespace Pako.Domain.Ledger;

public enum JournalType
{
    Sale,
    Purchase,
    Cash,
    Bank,
    General,
    Miscellaneous
}

// SequenceNextNumber/SequencePadding are the numbering config only; Kosovo VAT Law
// Article 45/56 requires the resulting sequence to be gapless and strictly monotonic
// per journal — not enforced yet, Phase 2 per docs/ROADMAP.md.
public class Journal
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public JournalType Type { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public Guid? DefaultDebitAccountId { get; set; }
    public Guid? DefaultCreditAccountId { get; set; }
    public string SequencePrefix { get; set; } = string.Empty;
    public int SequenceNextNumber { get; set; } = 1;
    public int SequencePadding { get; set; } = 4;
}
