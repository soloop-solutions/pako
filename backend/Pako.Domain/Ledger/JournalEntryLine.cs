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

    // Plani Kontabel v2.0 (COA_V2_IMPLEMENTATION_BRIEF.md Stage 1, R19 / 40_Cost_Centers).
    // Debit/Credit above stay in the company's functional currency (EUR) regardless — these
    // three only record the original foreign-currency facts for a multi-currency line.
    public Guid? CostCenterId { get; set; }
    public string? OriginalCurrency { get; set; }
    public decimal? OriginalAmount { get; set; }
    public decimal? ExchangeRate { get; set; }

    public JournalEntry? JournalEntry { get; set; }
}
