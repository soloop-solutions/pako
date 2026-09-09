namespace Pako.Domain.Companies;

// S0.3 (Sprint 0 registers, additive/inert): the item register's schema. Code is a plain data
// column here — the per-company ordinal series machinery (1...35000+) is Track B1/B6's job to
// wire up, not Sprint 0's. No quantities/valuation (explicitly out of scope for this release).
public class Item
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public int Code { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Unit { get; set; } = string.Empty;
    public Guid? DefaultTaxDefinitionId { get; set; }
    public Guid? DefaultRevenueAccountId { get; set; }
    public Guid? DefaultExpenseAccountId { get; set; }
    public decimal? DefaultUnitPrice { get; set; }

    public List<ItemBarcode> Barcodes { get; set; } = new();
}
