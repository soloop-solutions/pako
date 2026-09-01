namespace Pako.Localization.Xk;

// The 20 short VAT codes from 20_VAT_Codes (Code column), for validating that every
// Account.DefaultVatCode in PAKO_COA_v2_seed.csv resolves to a real code
// (COA_V2_IMPLEMENTATION_BRIEF.md Stage 2's startup validation test). This is NOT Stage 3's
// actual VAT-code seed data (rate, direction, deductibility, ATK book, reverse-charge flag per
// code) — just the code strings themselves, needed a stage early because the validation test
// needs something to check DefaultVatCode against.
public static class VatCodeReference
{
    public static readonly IReadOnlySet<string> Codes = new HashSet<string>
    {
        "S18", "S08", "S00", "SEXP", "SEX", "SRC",
        "B18", "B08", "B00", "BEX", "BND", "BV50",
        "I18", "I08", "IEX", "IND",
        "RC18", "RC00",
        "INV",
        "NA"
    };
}
