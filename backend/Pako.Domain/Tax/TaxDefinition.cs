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

// 20_VAT_Codes "Drejtimi" column. Kept alongside TaxScope rather than replacing it (the
// implementation brief said "replace") — TaxScope is still what ReportsController.VatReturn
// and the frontend's tax-enums.ts key off, and the 5 existing seeded TaxDefinition rows have
// no v2.0 code data yet. Stage 3, which actually seeds 20_VAT_Codes/21_WHT_Codes, is the right
// place to migrate that logic onto Direction and retire Scope.
public enum TaxDirection
{
    Out,
    In,
    Imp,
    Rc,
    None
}

// 20_VAT_Codes "Libri ATK" column: which ATK purchase/sales book this code's transactions are
// reported in. '-' in the sheet maps to None.
public enum TaxAtkBook
{
    Shitje,
    Blerje,
    BlerjeImport,
    BlerjeInvestime,
    None
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

    // Plani Kontabel v2.0 fields (COA_V2_IMPLEMENTATION_BRIEF.md Stage 1, 20_VAT_Codes).
    // Nullable/false-default: the current 5 seeded rows (DefaultTaxDefinitionsTemplate)
    // predate v2.0 and carry none of this data until Stage 3 reseeds from 20_VAT_Codes/
    // 21_WHT_Codes.
    public TaxDirection? Direction { get; set; }

    // Null = "-" in the sheet (not applicable — every OUT/NONE-direction code), distinct from
    // an actual 0%. 0/50/100 = the real purchase-side deductible percentage.
    public decimal? DeductiblePercent { get; set; }
    public bool IsReverseCharge { get; set; }
    public TaxAtkBook? AtkBook { get; set; }

    // The short v2.0 code (S18, B08, RC18, NA, ...), unique per company.
    public string? Code { get; set; }

    public List<TaxRepartitionLine> RepartitionLines { get; set; } = new();
}
