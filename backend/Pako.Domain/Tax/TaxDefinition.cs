namespace Pako.Domain.Tax;

public enum TaxType
{
    VatStandard,
    VatReduced,
    VatExempt,
    Withholding
}

public enum TaxScope
{
    Sale,
    Purchase,
    Both
}

public class TaxDefinition
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public decimal Rate { get; set; }
    public TaxType Type { get; set; }
    public TaxScope Scope { get; set; }
    public bool IsActive { get; set; } = true;

    public List<TaxRepartitionLine> RepartitionLines { get; set; } = new();
}
