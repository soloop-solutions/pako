namespace Pako.Domain.Tax;

// How a computed tax amount splits across GL accounts when a line is taxed. Kosovo VAT law
// (standard/reduced/exempt only, no multi-box repartition) needs at most one line per
// TaxDefinition today — Percentage/Tag exist so a future VAT-return-box mapping or a genuinely
// split tax doesn't require a schema change, not because that generality is used yet.
public class TaxRepartitionLine
{
    public Guid Id { get; set; }
    public Guid TaxDefinitionId { get; set; }
    public decimal Percentage { get; set; } = 100m;
    public Guid AccountId { get; set; }
    public string? Tag { get; set; }

    public TaxDefinition? TaxDefinition { get; set; }
}
