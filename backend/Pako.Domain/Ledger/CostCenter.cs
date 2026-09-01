using Pako.Domain.Companies;

namespace Pako.Domain.Ledger;

// 40_Cost_Centers: the optional analytic dimension a JournalEntryLine can carry
// (JournalEntryLine.CostCenterId). Company-scoped, same multi-tenant pattern as
// Account/Journal/TaxDefinition. Not seeded in Stage 1 (schema only) — the 12 standard
// cost centers land in Stage 2 alongside the chart.
public class CostCenter
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    public CompanyProfile Profile { get; set; } = CompanyProfile.None;
}
