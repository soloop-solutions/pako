using Pako.Domain.Ledger;
using Pako.Domain.Tax;

namespace Pako.Tests;

// 60_Posting_Rules (COA_V2_IMPLEMENTATION_BRIEF.md Stage 4). R02/R03/R04/R05 are exercised at
// the controller level (JournalEntriesControllerTests) since they're only reachable through the
// manual-entry endpoint; these are the pure-function cases for R07/R08/R09, which the manual
// endpoint can't reach at all (CreateJournalEntryLineRequest has no TaxId field), so they're
// only reachable through Invoice/Bill.Post — tested here directly against the validator instead.
public class PostingRuleValidatorTests
{
    // R07
    [Fact]
    public void ValidateVatCounterpartyTaxNumber_NaCode_NeverThrows()
    {
        PostingRuleValidator.ValidateVatCounterpartyTaxNumber("NA", null, null);
    }

    [Fact]
    public void ValidateVatCounterpartyTaxNumber_RealCodeNoPartner_Throws()
    {
        var ex = Assert.Throws<MissingCounterpartyTaxNumberException>(() =>
            PostingRuleValidator.ValidateVatCounterpartyTaxNumber("S18", null, null));
        Assert.Equal("S18", ex.VatCode);
    }

    [Fact]
    public void ValidateVatCounterpartyTaxNumber_RealCodePartnerWithNoTaxNumber_Throws()
    {
        Assert.Throws<MissingCounterpartyTaxNumberException>(() =>
            PostingRuleValidator.ValidateVatCounterpartyTaxNumber("S18", Guid.NewGuid(), null));
    }

    [Fact]
    public void ValidateVatCounterpartyTaxNumber_RealCodePartnerWithTaxNumber_Succeeds()
    {
        PostingRuleValidator.ValidateVatCounterpartyTaxNumber("S18", Guid.NewGuid(), "810123456");
    }

    // R08
    [Theory]
    [InlineData(TaxDirection.Out, 4, true)]
    [InlineData(TaxDirection.Out, 1, false)]
    [InlineData(TaxDirection.In, 1, true)]
    [InlineData(TaxDirection.In, 5, true)]
    [InlineData(TaxDirection.In, 6, true)]
    [InlineData(TaxDirection.In, 4, false)]
    [InlineData(TaxDirection.Imp, 1, true)]
    [InlineData(TaxDirection.Rc, 6, true)]
    [InlineData(TaxDirection.None, 2, true)]
    public void ValidateVatDirectionAgainstAccountClass_MatchesExpected(TaxDirection direction, int accountClass, bool shouldSucceed)
    {
        if (shouldSucceed)
        {
            PostingRuleValidator.ValidateVatDirectionAgainstAccountClass("X", direction, accountClass);
        }
        else
        {
            var ex = Assert.Throws<VatDirectionAccountClassMismatchException>(() =>
                PostingRuleValidator.ValidateVatDirectionAgainstAccountClass("X", direction, accountClass));
            Assert.Equal(accountClass, ex.AccountClass);
            Assert.Equal(direction, ex.Direction);
        }
    }

    // R09
    [Theory]
    [InlineData("113110", true)]
    [InlineData("113900", true)]
    [InlineData("210110", true)]
    [InlineData("400100", false)]
    [InlineData("661200", false)]
    public void ValidateVatNotAppliedToControlAccount_MatchesExpected(string accountCode, bool shouldThrow)
    {
        if (shouldThrow)
        {
            var ex = Assert.Throws<VatOnControlAccountException>(() =>
                PostingRuleValidator.ValidateVatNotAppliedToControlAccount("S18", accountCode));
            Assert.Equal(accountCode, ex.AccountCode);
        }
        else
        {
            PostingRuleValidator.ValidateVatNotAppliedToControlAccount("S18", accountCode);
        }
    }

    // R02/R04/R05 direct unit coverage (in addition to the controller-level tests).
    [Fact]
    public void ValidateManualLineAccountEligibility_NonPostable_Throws()
    {
        var ex = Assert.Throws<NonPostableAccountException>(() =>
            PostingRuleValidator.ValidateManualLineAccountEligibility("110900", isPostable: false, isControl: false));
        Assert.Equal("110900", ex.AccountCode);
    }

    [Fact]
    public void ValidateManualLineAccountEligibility_Control_Throws()
    {
        Assert.Throws<ControlAccountManualPostingException>(() =>
            PostingRuleValidator.ValidateManualLineAccountEligibility("110100", isPostable: true, isControl: true));
    }

    [Fact]
    public void ValidateManualLineAccountEligibility_CurrentYearProfitLoss_Throws()
    {
        Assert.Throws<SystemComputedAccountPostingException>(() =>
            PostingRuleValidator.ValidateManualLineAccountEligibility("304100", isPostable: true, isControl: false));
    }

    [Fact]
    public void ValidateManualLineAccountEligibility_OrdinaryPostableAccount_Succeeds()
    {
        PostingRuleValidator.ValidateManualLineAccountEligibility("660400", isPostable: true, isControl: false);
    }

    // R03
    [Fact]
    public void ValidatePartnerSubledgerReference_PartnerSubledgerNoPartnerId_Throws()
    {
        var ex = Assert.Throws<MissingSubledgerReferenceException>(() =>
            PostingRuleValidator.ValidatePartnerSubledgerReference("110100", SubledgerType.Partner, null));
        Assert.Equal(SubledgerType.Partner, ex.Subledger);
    }

    [Fact]
    public void ValidatePartnerSubledgerReference_NonPartnerSubledger_NeverThrows()
    {
        PostingRuleValidator.ValidatePartnerSubledgerReference("120100", SubledgerType.Item, null);
        PostingRuleValidator.ValidatePartnerSubledgerReference("101001", SubledgerType.Bank, null);
    }
}
