namespace Pako.Domain.Ledger;

public class JournalEntryLine
{
    public Guid Id { get; set; }
    public Guid JournalEntryId { get; set; }
    public Guid AccountId { get; set; }
    public Guid? PartnerId { get; set; }
    public decimal Debit { get; set; }
    public decimal Credit { get; set; }
    public string? Description { get; set; }
    public Guid? TaxId { get; set; }
    public bool ReconciledFlag { get; set; }
    public Guid? ReconciliationId { get; set; }

    public JournalEntry? JournalEntry { get; set; }
}
