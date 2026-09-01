using Pako.Domain.Companies;
using Pako.Domain.Tax;
using Pako.Localization.Xk;

namespace Pako.Tests;

// COA_V2_IMPLEMENTATION_BRIEF.md Stage 3.
public class VatWithholdingTemplateTests
{
    [Fact]
    public void VatCodes_HasExactlyTwentyEntries()
    {
        Assert.Equal(20, VatWithholdingTemplate.VatCodes.Count);
    }

    [Fact]
    public void VatCodes_AreUnique()
    {
        var codes = VatWithholdingTemplate.VatCodes.Select(c => c.Code).ToList();
        Assert.Equal(codes.Count, codes.Distinct().Count());
    }

    [Fact]
    public void WithholdingCodes_HasExactlySixEntries_WagePayrollExcluded()
    {
        Assert.Equal(6, VatWithholdingTemplate.WithholdingCodes.Count);
        Assert.DoesNotContain(VatWithholdingTemplate.WithholdingCodes, c => c.Code == "WHT-PAG");
    }

    [Theory]
    [InlineData("S18", TaxDirection.Out, 0.18)]
    [InlineData("B18", TaxDirection.In, 0.18)]
    [InlineData("I18", TaxDirection.Imp, 0.18)]
    [InlineData("RC18", TaxDirection.Rc, 0.18)]
    [InlineData("NA", TaxDirection.None, 0.00)]
    public void VatCodes_DirectionAndRateMatchSource(string code, TaxDirection expectedDirection, double expectedRate)
    {
        var entry = VatWithholdingTemplate.VatCodes.Single(c => c.Code == code);
        Assert.Equal(expectedDirection, entry.Direction);
        Assert.Equal((decimal)expectedRate, entry.Rate);
    }

    [Fact]
    public void VatCodes_RC18AndRC00AreFlaggedReverseChargeWithNoOrdinaryRepartitionLines()
    {
        var rc18 = VatWithholdingTemplate.VatCodes.Single(c => c.Code == "RC18");
        var rc00 = VatWithholdingTemplate.VatCodes.Single(c => c.Code == "RC00");

        Assert.True(rc18.IsReverseCharge);
        Assert.Empty(rc18.RepartitionTargets);
        Assert.True(rc00.IsReverseCharge);
        Assert.Empty(rc00.RepartitionTargets);
    }

    [Fact]
    public void VatCodes_BV50SplitsFiftyFiftyBetweenDeductibleAndNonDeductible()
    {
        var bv50 = VatWithholdingTemplate.VatCodes.Single(c => c.Code == "BV50");

        Assert.Equal(50m, bv50.DeductiblePercent);
        Assert.Equal(2, bv50.RepartitionTargets.Count);
        Assert.Equal(100m, bv50.RepartitionTargets.Sum(t => t.Percentage));
        Assert.Contains(bv50.RepartitionTargets, t => t is { AccountCode: "113110", Percentage: 50m });
        Assert.Contains(bv50.RepartitionTargets, t => t is { AccountCode: "113900", Percentage: 50m });
    }

    [Fact]
    public void CreateTaxDefinitions_ForCoreOnlyCompany_SkipsImportScopedCodes()
    {
        var companyId = Guid.NewGuid();
        var accountIdsByCode = ChartOfAccountsV2Template.ForProfiles(CompanyProfile.Core)
            .ToDictionary(e => e.Code, _ => Guid.NewGuid());

        var definitions = VatWithholdingTemplate.CreateTaxDefinitions(companyId, accountIdsByCode);

        Assert.DoesNotContain(definitions, d => d.Code == "I18");
        Assert.DoesNotContain(definitions, d => d.Code == "I08");
        Assert.DoesNotContain(definitions, d => d.Code == "IND");
        Assert.Contains(definitions, d => d.Code == "S18");
        Assert.Contains(definitions, d => d.Code == "B18");
    }

    [Fact]
    public void CreateTaxDefinitions_ForImportCompany_IncludesImportScopedCodes()
    {
        var companyId = Guid.NewGuid();
        var accountIdsByCode = ChartOfAccountsV2Template.ForProfiles(CompanyProfile.Core | CompanyProfile.Import)
            .ToDictionary(e => e.Code, _ => Guid.NewGuid());

        var definitions = VatWithholdingTemplate.CreateTaxDefinitions(companyId, accountIdsByCode);

        var i18 = Assert.Single(definitions, d => d.Code == "I18");
        Assert.Single(i18.RepartitionLines);
        Assert.Equal(accountIdsByCode["113200"], i18.RepartitionLines[0].AccountId);
    }

    [Fact]
    public void CreateTaxDefinitions_EveryDefinitionHasAUniqueNameAndCode()
    {
        var companyId = Guid.NewGuid();
        var accountIdsByCode = ChartOfAccountsV2Template.ForProfiles(
                CompanyProfile.Core | CompanyProfile.Import | CompanyProfile.Payroll)
            .ToDictionary(e => e.Code, _ => Guid.NewGuid());

        var definitions = VatWithholdingTemplate.CreateTaxDefinitions(companyId, accountIdsByCode);

        Assert.Equal(definitions.Count, definitions.Select(d => d.Name).Distinct().Count());
        Assert.Equal(definitions.Count, definitions.Select(d => d.Code).Distinct().Count());
    }

    [Fact]
    public void CreateTaxDefinitions_RepartitionAmountsSumToTaxAmountForATwoLineCode()
    {
        var companyId = Guid.NewGuid();
        var accountIdsByCode = ChartOfAccountsV2Template.ForProfiles(CompanyProfile.Core)
            .ToDictionary(e => e.Code, _ => Guid.NewGuid());

        var definitions = VatWithholdingTemplate.CreateTaxDefinitions(companyId, accountIdsByCode);
        var bv50 = definitions.Single(d => d.Code == "BV50");

        var result = new TaxComputationService().Compute(1000m, bv50);

        Assert.Equal(180m, result.TaxAmount);
        Assert.Equal(2, result.PostingLines.Count);
        Assert.Equal(90m, result.PostingLines[0].Amount);
        Assert.Equal(90m, result.PostingLines[1].Amount);
    }
}
