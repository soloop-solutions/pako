using Pako.Domain.Tax;

namespace Pako.Localization.Xk;

public record TaxDefinitionTemplateEntry(string Name, decimal Rate, TaxType Type, TaxScope Scope, string? RepartitionAccountCode);

// Standard/Reduced VAT need separate Sale- and Purchase-scoped definitions because a sale's tax
// posts to VAT Payable while a purchase's posts to VAT Receivable (Input VAT) — one
// TaxDefinition can't cover both since TaxRepartitionLine.AccountId is a single target. Exempt
// has no repartition line: no tax amount is ever computed for it, so there's no GL account to
// post to.
public static class DefaultTaxDefinitionsTemplate
{
    // Repointed at Plani Kontabel v2.0's control accounts (COA_V2_IMPLEMENTATION_BRIEF.md Stage
    // 2, 10_COA_Master) — "2100"/"1300" were the old 16-account placeholder chart's codes, which
    // company creation no longer seeds once Stage 2 lands. 210100 "Output VAT - Control" and
    // 113100 "Input VAT - Control" are v2's direct equivalents (same "Was VAT18 - now NA. Summary/
    // control only" role), both CORE-profile so always present. This is the minimum necessary to
    // keep these 5 existing tax definitions functional against the new chart — not Stage 3's
    // actual work of seeding the real 20 VAT codes from 20_VAT_Codes.
    public const string VatPayableAccountCode = "210100";
    public const string VatReceivableAccountCode = "113100";

    public static readonly IReadOnlyList<TaxDefinitionTemplateEntry> Entries = new List<TaxDefinitionTemplateEntry>
    {
        new("VAT 18% (Sales)", RateFor("Standard"), TaxType.VatStandard, TaxScope.Sale, VatPayableAccountCode),
        new("VAT 18% (Purchases)", RateFor("Standard"), TaxType.VatStandard, TaxScope.Purchase, VatReceivableAccountCode),
        new("VAT 8% (Sales)", RateFor("Reduced"), TaxType.VatReduced, TaxScope.Sale, VatPayableAccountCode),
        new("VAT 8% (Purchases)", RateFor("Reduced"), TaxType.VatReduced, TaxScope.Purchase, VatReceivableAccountCode),
        new("Exempt", RateFor("Exempt"), TaxType.VatExempt, TaxScope.Both, null)
    };

    private static decimal RateFor(string name) => KosovoVatRates.Rates.First(r => r.Name == name).Rate;

    public static List<TaxDefinition> CreateDefaultTaxDefinitions(Guid companyId, IReadOnlyDictionary<string, Guid> accountIdsByCode)
    {
        var result = new List<TaxDefinition>();

        foreach (var entry in Entries)
        {
            var taxDefinition = new TaxDefinition
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Name = entry.Name,
                Rate = entry.Rate,
                Type = entry.Type,
                Scope = entry.Scope,
                IsActive = true
            };

            if (entry.RepartitionAccountCode is not null)
            {
                taxDefinition.RepartitionLines.Add(new TaxRepartitionLine
                {
                    Id = Guid.NewGuid(),
                    TaxDefinitionId = taxDefinition.Id,
                    Percentage = 100m,
                    AccountId = accountIdsByCode[entry.RepartitionAccountCode]
                });
            }

            result.Add(taxDefinition);
        }

        return result;
    }
}
