using Pako.Domain.Tax;

namespace Pako.Localization.Xk;

// 20_VAT_Codes: one entry per VAT code. RepartitionTargets are (account code, percentage) pairs
// the computed tax amount posts to — empty for 0%-rate codes (nothing to post) and for RC18/RC00
// (COA_V2_IMPLEMENTATION_BRIEF.md Stage 4's R10 AUTO rule generates their two lines directly,
// not through the ordinary TaxComputationService repartition mechanism — see PostingRules.cs).
// VerificationNote is set for every row the sheet marks with a *** / "TO VERIFY".
public record VatCodeTemplateEntry(
    string Code,
    string NameSq,
    string NameEn,
    TaxDirection Direction,
    decimal Rate,
    decimal? DeductiblePercent,
    bool IsReverseCharge,
    TaxAtkBook AtkBook,
    IReadOnlyList<(string AccountCode, decimal Percentage)> RepartitionTargets,
    SourceConfidence Confidence,
    string? VerificationNote = null);

// 21_WHT_Codes, excluding WHT-PAG (wage tax — "Separate payroll engine" per its own note; already
// computed by IPayrollCalculationService/KosovoPersonalIncomeTaxBrackets, not a flat-rate code).
public record WithholdingCodeTemplateEntry(
    string Code,
    string NameSq,
    string NameEn,
    decimal Rate,
    string? RepartitionAccountCode,
    SourceConfidence Confidence);

public static class VatWithholdingTemplate
{
    public static readonly IReadOnlyList<VatCodeTemplateEntry> VatCodes = new List<VatCodeTemplateEntry>
    {
        new("S18", "Shitje vendore 18%", "Domestic sale 18%", TaxDirection.Out, 0.18m, null, false, TaxAtkBook.Shitje,
            new[] { ("210110", 100m) }, SourceConfidence.PrimarySource),
        new("S08", "Shitje vendore 8%", "Domestic sale 8%", TaxDirection.Out, 0.08m, null, false, TaxAtkBook.Shitje,
            new[] { ("210120", 100m) }, SourceConfidence.PrimarySource),
        new("S00", "Shitje 0%", "Zero-rated sale", TaxDirection.Out, 0.00m, null, false, TaxAtkBook.Shitje,
            Array.Empty<(string, decimal)>(), SourceConfidence.PrimarySource),
        new("SEXP", "Eksport", "Export", TaxDirection.Out, 0.00m, null, false, TaxAtkBook.Shitje,
            Array.Empty<(string, decimal)>(), SourceConfidence.PrimarySource),
        new("SEX", "Shitje e liruar (pa kredi)", "Exempt supply (no credit)", TaxDirection.Out, 0.00m, null, false, TaxAtkBook.Shitje,
            Array.Empty<(string, decimal)>(), SourceConfidence.PrimarySource),
        new("SRC", "Shitje me ngarkese te kundert", "Sale under reverse charge", TaxDirection.Out, 0.00m, null, true, TaxAtkBook.Shitje,
            Array.Empty<(string, decimal)>(), SourceConfidence.NeedsLegalVerification, "Scope TO VERIFY — which domestic supplies fall under domestic reverse charge (99_Open_Questions Q12)."),
        new("B18", "Blerje vendore 18%", "Domestic purchase 18%", TaxDirection.In, 0.18m, 100m, false, TaxAtkBook.Blerje,
            new[] { ("113110", 100m) }, SourceConfidence.PrimarySource),
        new("B08", "Blerje vendore 8%", "Domestic purchase 8%", TaxDirection.In, 0.08m, 100m, false, TaxAtkBook.Blerje,
            new[] { ("113120", 100m) }, SourceConfidence.PrimarySource),
        new("B00", "Blerje 0%", "Zero-rated purchase", TaxDirection.In, 0.00m, 100m, false, TaxAtkBook.Blerje,
            Array.Empty<(string, decimal)>(), SourceConfidence.PrimarySource),
        new("BEX", "Blerje e liruar", "Exempt purchase", TaxDirection.In, 0.00m, 0m, false, TaxAtkBook.Blerje,
            Array.Empty<(string, decimal)>(), SourceConfidence.PrimarySource),
        new("BND", "Blerje me TVSH te pazbritshme", "Purchase, non-deductible VAT", TaxDirection.In, 0.18m, 0m, false, TaxAtkBook.Blerje,
            new[] { ("113900", 100m) }, SourceConfidence.PrimarySource),
        new("BV50", "Blerje automjeti / kosto automjeti 50%", "Vehicle purchase or running cost, 50%", TaxDirection.In, 0.18m, 50m, false, TaxAtkBook.Blerje,
            new[] { ("113110", 50m), ("113900", 50m) }, SourceConfidence.NeedsLegalVerification, "50% cap TO VERIFY per case (99_Open_Questions Q10)."),
        new("I18", "Import 18% (TVSH ne dogane)", "Import 18% (VAT paid at customs)", TaxDirection.Imp, 0.18m, 100m, false, TaxAtkBook.BlerjeImport,
            new[] { ("113200", 100m) }, SourceConfidence.PrimarySource),
        new("I08", "Import 8%", "Import 8%", TaxDirection.Imp, 0.08m, 100m, false, TaxAtkBook.BlerjeImport,
            new[] { ("113200", 100m) }, SourceConfidence.PrimarySource),
        new("IEX", "Import i liruar", "Exempt import", TaxDirection.Imp, 0.00m, null, false, TaxAtkBook.BlerjeImport,
            Array.Empty<(string, decimal)>(), SourceConfidence.NeedsLegalVerification, "Conditions TO VERIFY — production lines, machinery, raw materials, IT equipment."),
        new("IND", "Import me TVSH te pazbritshme", "Import, non-deductible VAT", TaxDirection.Imp, 0.18m, 0m, false, TaxAtkBook.BlerjeImport,
            new[] { ("511200", 100m) }, SourceConfidence.PrimarySource),
        new("RC18", "Ngarkese e kundert - sherbime nga jashte 18%", "Reverse charge - imported services 18%", TaxDirection.Rc, 0.18m, 100m, true, TaxAtkBook.Blerje,
            Array.Empty<(string, decimal)>(), SourceConfidence.PrimarySource),
        new("RC00", "Ngarkese e kundert - e liruar", "Reverse charge - exempt", TaxDirection.Rc, 0.00m, 0m, true, TaxAtkBook.Blerje,
            Array.Empty<(string, decimal)>(), SourceConfidence.PrimarySource),
        new("INV", "Blerje investive", "Capital / investment purchase", TaxDirection.In, 0.18m, 100m, false, TaxAtkBook.BlerjeInvestime,
            new[] { ("113110", 100m) }, SourceConfidence.NeedsLegalVerification, "Separate ATK purchase-book column TO VERIFY (99_Open_Questions Q08); GL posting reuses B18's account."),
        new("NA", "Nuk aplikohet", "Not applicable", TaxDirection.None, 0.00m, null, false, TaxAtkBook.None,
            Array.Empty<(string, decimal)>(), SourceConfidence.PrimarySource)
    };

    // 21_WHT_Codes, matched to the existing KosovoWithholdingRates by category (same rates,
    // reused rather than re-declared). WHT-PAG excluded — see WithholdingCodeTemplateEntry's doc.
    public static readonly IReadOnlyList<WithholdingCodeTemplateEntry> WithholdingCodes = new List<WithholdingCodeTemplateEntry>
    {
        new("WHT-QIRA", "Tatimi ne qira", "Rent withholding", RateFor("Rent"), "214100", SourceConfidence.NeedsLegalVerification),
        new("WHT-INT", "Tatimi mbi interesin", "Interest withholding", RateFor("Interest"), "212100", SourceConfidence.NeedsLegalVerification),
        new("WHT-ROY", "Tatimi mbi honoraret", "Royalties withholding", RateFor("Royalties"), "212100", SourceConfidence.NeedsLegalVerification),
        new("WHT-NRS", "Sherbime nga jo-rezidente", "Non-resident services withholding", RateFor("NonResidentServices"), "212100", SourceConfidence.NeedsLegalVerification),
        new("WHT-IND", "Pagesa individeve jo-biznes", "Non-business individuals withholding", RateFor("NonBusinessFarmersRecycledMaterials"), "212100", SourceConfidence.NeedsLegalVerification),
        new("WHT-DIV", "Tatimi mbi dividendet", "Dividend withholding", RateFor("Dividends"), null, SourceConfidence.NeedsLegalVerification)
    };

    private static decimal RateFor(string category) =>
        KosovoWithholdingRates.Rates.First(r => r.Category == category).Rate;

    // Builds one TaxDefinition per VAT/withholding code, skipping any whose repartition targets
    // aren't all present in accountIdsByCode — happens for Import-scoped codes (I18/I08/IND,
    // targeting 113200/511200) on a company that doesn't have the Import profile enabled, same
    // "never reference an account this company doesn't have" discipline Stage 2 established for
    // CompanyAccountDefaults.
    public static List<TaxDefinition> CreateTaxDefinitions(Guid companyId, IReadOnlyDictionary<string, Guid> accountIdsByCode)
    {
        var result = new List<TaxDefinition>();

        foreach (var entry in VatCodes)
        {
            if (!entry.RepartitionTargets.All(t => accountIdsByCode.ContainsKey(t.AccountCode)))
            {
                continue;
            }

            var taxDefinition = new TaxDefinition
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Name = entry.NameEn,
                Code = entry.Code,
                Rate = entry.Rate,
                Type = entry.Rate == 0.18m ? TaxType.VatStandard : entry.Rate == 0.08m ? TaxType.VatReduced : TaxType.VatExempt,
                Scope = entry.Direction switch
                {
                    TaxDirection.Out => TaxScope.Sale,
                    TaxDirection.In or TaxDirection.Imp => TaxScope.Purchase,
                    _ => TaxScope.Both
                },
                Direction = entry.Direction,
                DeductiblePercent = entry.DeductiblePercent,
                IsReverseCharge = entry.IsReverseCharge,
                AtkBook = entry.AtkBook,
                IsActive = true
            };

            foreach (var (accountCode, percentage) in entry.RepartitionTargets)
            {
                taxDefinition.RepartitionLines.Add(new TaxRepartitionLine
                {
                    Id = Guid.NewGuid(),
                    TaxDefinitionId = taxDefinition.Id,
                    Percentage = percentage,
                    AccountId = accountIdsByCode[accountCode]
                });
            }

            result.Add(taxDefinition);
        }

        foreach (var entry in WithholdingCodes)
        {
            if (entry.RepartitionAccountCode is not null && !accountIdsByCode.ContainsKey(entry.RepartitionAccountCode))
            {
                continue;
            }

            var taxDefinition = new TaxDefinition
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Name = entry.NameEn,
                Code = entry.Code,
                Rate = entry.Rate,
                Type = TaxType.Withholding,
                Scope = TaxScope.Both,
                Direction = TaxDirection.None,
                AtkBook = TaxAtkBook.None,
                IsActive = true
            };

            if (entry.RepartitionAccountCode is { } code)
            {
                taxDefinition.RepartitionLines.Add(new TaxRepartitionLine
                {
                    Id = Guid.NewGuid(),
                    TaxDefinitionId = taxDefinition.Id,
                    Percentage = 100m,
                    AccountId = accountIdsByCode[code]
                });
            }

            result.Add(taxDefinition);
        }

        return result;
    }
}
