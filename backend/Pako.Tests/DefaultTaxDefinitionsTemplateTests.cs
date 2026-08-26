using Pako.Domain.Tax;
using Pako.Localization.Xk;

namespace Pako.Tests;

public class DefaultTaxDefinitionsTemplateTests
{
    private static Dictionary<string, Guid> AccountIdsByCode() => new()
    {
        [DefaultTaxDefinitionsTemplate.VatPayableAccountCode] = Guid.NewGuid(),
        [DefaultTaxDefinitionsTemplate.VatReceivableAccountCode] = Guid.NewGuid()
    };

    [Fact]
    public void CreateDefaultTaxDefinitions_ProducesStandardReducedAndExemptDefinitions()
    {
        var companyId = Guid.NewGuid();
        var accountIds = AccountIdsByCode();

        var definitions = DefaultTaxDefinitionsTemplate.CreateDefaultTaxDefinitions(companyId, accountIds);

        Assert.Equal(5, definitions.Count);
        Assert.All(definitions, d => Assert.Equal(companyId, d.CompanyId));
        Assert.All(definitions, d => Assert.True(d.IsActive));

        var vatSales18 = definitions.Single(d => d.Name == "VAT 18% (Sales)");
        Assert.Equal(0.18m, vatSales18.Rate);
        Assert.Equal(TaxType.VatStandard, vatSales18.Type);
        Assert.Equal(TaxScope.Sale, vatSales18.Scope);
        Assert.Equal(accountIds[DefaultTaxDefinitionsTemplate.VatPayableAccountCode], vatSales18.RepartitionLines.Single().AccountId);

        var vatPurchases18 = definitions.Single(d => d.Name == "VAT 18% (Purchases)");
        Assert.Equal(TaxScope.Purchase, vatPurchases18.Scope);
        Assert.Equal(accountIds[DefaultTaxDefinitionsTemplate.VatReceivableAccountCode], vatPurchases18.RepartitionLines.Single().AccountId);

        var vatSales8 = definitions.Single(d => d.Name == "VAT 8% (Sales)");
        Assert.Equal(0.08m, vatSales8.Rate);
        Assert.Equal(TaxType.VatReduced, vatSales8.Type);

        var exempt = definitions.Single(d => d.Name == "Exempt");
        Assert.Equal(0.00m, exempt.Rate);
        Assert.Equal(TaxType.VatExempt, exempt.Type);
        Assert.Equal(TaxScope.Both, exempt.Scope);
        Assert.Empty(exempt.RepartitionLines);
    }

    [Fact]
    public void CreateDefaultTaxDefinitions_EachRepartitionLineIsFullyAllocated()
    {
        var definitions = DefaultTaxDefinitionsTemplate.CreateDefaultTaxDefinitions(Guid.NewGuid(), AccountIdsByCode());

        foreach (var definition in definitions.Where(d => d.RepartitionLines.Count > 0))
        {
            Assert.Equal(100m, definition.RepartitionLines.Sum(r => r.Percentage));
        }
    }
}
