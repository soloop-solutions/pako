using Pako.Domain.Documents;
using Pako.Domain.Invoicing;
using Pako.Domain.Tax;

namespace Pako.Tests;

// C1: "Done when the same invoice entered both ways produces the identical journal entry, proven
// by a test that runs the pair across every seeded VAT rate — 18%, 8%, 0%, exempt and RC18."
public class DocumentLineCalculatorTests
{
    private static readonly TaxComputationService TaxService = new();
    private static readonly Guid NetAccountId = Guid.NewGuid();
    private static readonly Guid VatAccountId = Guid.NewGuid();
    private static readonly Guid ReverseChargeInputVatAccountId = Guid.NewGuid();
    private static readonly Guid ReverseChargeOutputVatAccountId = Guid.NewGuid();

    private static TaxDefinition Standard18() => new()
    {
        Id = Guid.NewGuid(),
        Rate = 0.18m,
        RepartitionLines = { new TaxRepartitionLine { AccountId = VatAccountId, Percentage = 100m } }
    };

    private static TaxDefinition Standard08() => new()
    {
        Id = Guid.NewGuid(),
        Rate = 0.08m,
        RepartitionLines = { new TaxRepartitionLine { AccountId = VatAccountId, Percentage = 100m } }
    };

    private static TaxDefinition ZeroRated() => new()
    {
        Id = Guid.NewGuid(),
        Rate = 0.00m
    };

    private static TaxDefinition Exempt() => new()
    {
        Id = Guid.NewGuid(),
        Rate = 0.00m
    };

    private static TaxDefinition ReverseCharge18() => new()
    {
        Id = Guid.NewGuid(),
        Rate = 0.18m,
        IsReverseCharge = true
    };

    private static DocumentLineResult Grossly(decimal unitPrice, TaxDefinition? tax) =>
        DocumentLineCalculator.Calculate(
            1m, unitPrice, 0m, NetAccountId, "Line", tax, isCreditNote: false, creditsOnNormalSide: true,
            TaxService, ReverseChargeInputVatAccountId, ReverseChargeOutputVatAccountId, PriceMode.GrossInclusive);

    private static DocumentLineResult Netly(decimal unitPrice, TaxDefinition? tax) =>
        DocumentLineCalculator.Calculate(
            1m, unitPrice, 0m, NetAccountId, "Line", tax, isCreditNote: false, creditsOnNormalSide: true,
            TaxService, ReverseChargeInputVatAccountId, ReverseChargeOutputVatAccountId, PriceMode.NetExclusive);

    private static void AssertIdenticalJournalEntry(DocumentLineResult gross, DocumentLineResult net)
    {
        Assert.Equal(gross.Gross, net.Gross);
        Assert.Equal(gross.NetAmount, net.NetAmount);
        Assert.Equal(gross.Lines.Count, net.Lines.Count);

        var grossLines = gross.Lines.OrderBy(l => l.AccountId).ThenBy(l => l.Debit).ToList();
        var netLines = net.Lines.OrderBy(l => l.AccountId).ThenBy(l => l.Debit).ToList();
        for (var i = 0; i < grossLines.Count; i++)
        {
            Assert.Equal(grossLines[i].AccountId, netLines[i].AccountId);
            Assert.Equal(grossLines[i].Debit, netLines[i].Debit);
            Assert.Equal(grossLines[i].Credit, netLines[i].Credit);
        }
    }

    [Fact]
    public void Standard18Percent_GrossAndNetEntry_ProduceIdenticalJournalEntry()
    {
        // 118 gross == 100 net + 18 tax, exactly, at 18%.
        AssertIdenticalJournalEntry(Grossly(118m, Standard18()), Netly(100m, Standard18()));
    }

    [Fact]
    public void Standard8Percent_GrossAndNetEntry_ProduceIdenticalJournalEntry()
    {
        // 108 gross == 100 net + 8 tax, exactly, at 8%.
        AssertIdenticalJournalEntry(Grossly(108m, Standard08()), Netly(100m, Standard08()));
    }

    [Fact]
    public void ZeroRated_GrossAndNetEntry_ProduceIdenticalJournalEntry()
    {
        AssertIdenticalJournalEntry(Grossly(100m, ZeroRated()), Netly(100m, ZeroRated()));
    }

    [Fact]
    public void Exempt_GrossAndNetEntry_ProduceIdenticalJournalEntry()
    {
        AssertIdenticalJournalEntry(Grossly(100m, Exempt()), Netly(100m, Exempt()));
    }

    [Fact]
    public void ReverseCharge18_GrossAndNetEntry_ProduceIdenticalJournalEntry()
    {
        // RC18: the foreign vendor never charged VAT, so the entered amount is fully net
        // regardless of PriceMode — both modes must self-assess the same 18.00 either way.
        var gross = Grossly(100m, ReverseCharge18());
        var net = Netly(100m, ReverseCharge18());

        AssertIdenticalJournalEntry(gross, net);

        var reverseChargeLine = gross.Lines.Single(l => l.AccountId == ReverseChargeInputVatAccountId);
        Assert.Equal(18.00m, reverseChargeLine.Debit);
    }

    [Fact]
    public void NoTax_GrossAndNetEntry_ProduceIdenticalJournalEntry()
    {
        AssertIdenticalJournalEntry(Grossly(100m, null), Netly(100m, null));
    }

    [Fact]
    public void NetExclusive_AddsVatOnTopOfEnteredPrice()
    {
        var result = Netly(100m, Standard18());

        Assert.Equal(100m, result.NetAmount);
        Assert.Equal(118m, result.Gross);
    }

    [Fact]
    public void GrossInclusive_BacksVatOutOfEnteredPrice()
    {
        var result = Grossly(118m, Standard18());

        Assert.Equal(100m, result.NetAmount);
        Assert.Equal(118m, result.Gross);
    }

    // Printed invoice line: 2 × 59.00 gross-inclusive at 18% with 10% rabat.
    [Fact]
    public void Amounts_GrossInclusiveWithDiscount_MatchesPosting()
    {
        var tax = Standard18();
        var amounts = DocumentLineCalculator.Amounts(2m, 59m, 10m, tax, TaxService, PriceMode.GrossInclusive);
        var posted = DocumentLineCalculator.Calculate(2m, 59m, 10m, NetAccountId, "x", tax, false, true, TaxService,
            ReverseChargeInputVatAccountId, ReverseChargeOutputVatAccountId, PriceMode.GrossInclusive);

        Assert.Equal(118m, amounts.AmountBeforeDiscount);
        Assert.Equal(11.80m, amounts.DiscountAmount);
        Assert.Equal(106.20m, amounts.GrossAmount);
        Assert.Equal(posted.Gross, amounts.GrossAmount);
        Assert.Equal(posted.NetAmount, amounts.NetAmount);
        Assert.Equal(amounts.GrossAmount, amounts.NetAmount + amounts.TaxAmount);
    }

    [Fact]
    public void Amounts_NetExclusiveWithDiscount_AddsVatOnTheDiscountedNet()
    {
        var amounts = DocumentLineCalculator.Amounts(1m, 100m, 25m, Standard18(), TaxService, PriceMode.NetExclusive);

        Assert.Equal((100m, 25m, 75m, 13.50m, 88.50m),
            (amounts.AmountBeforeDiscount, amounts.DiscountAmount, amounts.NetAmount, amounts.TaxAmount, amounts.GrossAmount));
    }

    [Fact]
    public void Amounts_NoTax_NetEqualsGross()
    {
        var amounts = DocumentLineCalculator.Amounts(3m, 10m, 0m, null, TaxService);

        Assert.Equal((30m, 0m, 30m, 0m, 30m),
            (amounts.AmountBeforeDiscount, amounts.DiscountAmount, amounts.NetAmount, amounts.TaxAmount, amounts.GrossAmount));
    }

    // Client request 2026-11-23: the printed invoice shows the unit price with and without VAT.
    [Fact]
    public void Amounts_GrossMode_GivesTheUnitPriceOnBothBases()
    {
        var amounts = DocumentLineCalculator.Amounts(2m, 118m, 10m, Standard18(), TaxService, PriceMode.GrossInclusive);

        Assert.Equal((100m, 118m), (amounts.UnitPriceNet, amounts.UnitPriceGross));
    }

    [Fact]
    public void Amounts_NetMode_GivesTheUnitPriceOnBothBases()
    {
        var amounts = DocumentLineCalculator.Amounts(3m, 10m, 0m, Standard08(), TaxService, PriceMode.NetExclusive);

        Assert.Equal((10m, 10.80m), (amounts.UnitPriceNet, amounts.UnitPriceGross));
    }

    [Fact]
    public void Amounts_ReverseChargeOrNoTax_UnitPriceIsTheSameOnBothBases()
    {
        var reverse = DocumentLineCalculator.Amounts(1m, 100m, 0m, ReverseCharge18(), TaxService, PriceMode.NetExclusive);
        var untaxed = DocumentLineCalculator.Amounts(1m, 100m, 0m, null, TaxService);

        Assert.Equal((100m, 100m), (reverse.UnitPriceNet, reverse.UnitPriceGross));
        Assert.Equal((100m, 100m), (untaxed.UnitPriceNet, untaxed.UnitPriceGross));
    }
}
