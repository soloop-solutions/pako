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

    // B14: analytic account id -> percentage of this line attributed to it, across whatever
    // analytic dimension(s) that id belongs to — CostCenter.Id is the only one that exists today,
    // but nothing about this shape ties it to CostCenter specifically, so a future dimension
    // reuses it with no schema change. Replaces the single-valued CostCenterId (Plani Kontabel
    // v2.0, COA_V2_IMPLEMENTATION_BRIEF.md Stage 1, R19 / 40_Cost_Centers) — migrated forward as
    // a single 100% entry per existing non-null CostCenterId (AnalyticDistributionForCostCenters
    // migration) — so a line can now split across more than one analytic account (e.g. 60/40
    // between two cost centers) instead of exactly one.
    public Dictionary<Guid, decimal>? AnalyticDistribution { get; set; }

    // Plani Kontabel v2.0 (COA_V2_IMPLEMENTATION_BRIEF.md Stage 1, R19 / 40_Cost_Centers).
    // Debit/Credit above stay in the company's functional currency (EUR) regardless — these
    // three only record the original foreign-currency facts for a multi-currency line.
    public string? OriginalCurrency { get; set; }
    public decimal? OriginalAmount { get; set; }
    public decimal? ExchangeRate { get; set; }

    public JournalEntry? JournalEntry { get; set; }
}
