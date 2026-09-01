using Pako.Domain.Tax;

namespace Pako.Tests;

public class TaxComputationServiceTests
{
    private readonly TaxComputationService _service = new();

    [Fact]
    public void Compute_StandardVatOnRoundAmount_ComputesExactCents()
    {
        var vatPayableAccountId = Guid.NewGuid();
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            Rate = 0.18m,
            RepartitionLines = { new TaxRepartitionLine { AccountId = vatPayableAccountId, Percentage = 100m } }
        };

        var result = _service.Compute(100m, taxDefinition);

        Assert.Equal(100m, result.NetAmount);
        Assert.Equal(18.00m, result.TaxAmount);
        Assert.Equal(118.00m, result.TotalAmount);
        Assert.Single(result.PostingLines);
        Assert.Equal(vatPayableAccountId, result.PostingLines[0].AccountId);
        Assert.Equal(18.00m, result.PostingLines[0].Amount);
    }

    [Fact]
    public void Compute_MidpointCent_RoundsAwayFromZero_NotToEven()
    {
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            Rate = 0.10m,
            RepartitionLines = { new TaxRepartitionLine { AccountId = Guid.NewGuid(), Percentage = 100m } }
        };

        var result = _service.Compute(0.25m, taxDefinition);

        Assert.Equal(0.03m, result.TaxAmount);
    }

    [Fact]
    public void Compute_ExemptTaxWithNoRepartitionLines_ReturnsZeroTaxAndNoPostingLines()
    {
        var taxDefinition = new TaxDefinition { Id = Guid.NewGuid(), Rate = 0.00m, Type = TaxType.VatExempt };

        var result = _service.Compute(500m, taxDefinition);

        Assert.Equal(0m, result.TaxAmount);
        Assert.Equal(500m, result.TotalAmount);
        Assert.Empty(result.PostingLines);
    }

    [Fact]
    public void Compute_MultipleRepartitionLines_SplitsProportionallyAndSumsToTaxAmount()
    {
        var accountA = Guid.NewGuid();
        var accountB = Guid.NewGuid();
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            Rate = 0.18m,
            RepartitionLines =
            {
                new TaxRepartitionLine { AccountId = accountA, Percentage = 60m, Tag = "box-1" },
                new TaxRepartitionLine { AccountId = accountB, Percentage = 40m, Tag = "box-2" }
            }
        };

        var result = _service.Compute(100m, taxDefinition);

        Assert.Equal(2, result.PostingLines.Count);
        Assert.Equal(10.80m, result.PostingLines.Single(l => l.AccountId == accountA).Amount);
        Assert.Equal(7.20m, result.PostingLines.Single(l => l.AccountId == accountB).Amount);
        Assert.Equal(result.PostingLines.Sum(l => l.Amount), result.TaxAmount);
    }

    // Invoicing/Bills line entry is gross — the case that motivated ComputeFromGross: naive
    // "net = gross/(1+rate)" then "tax = net*rate" independently rounded do NOT sum back to the
    // original gross (100 -> net 84.75, naive tax 84.75*0.18=15.255 rounds to 15.26, total
    // 100.01). Tax must be the exact remainder (gross - net), not an independent rounding.
    [Fact]
    public void ComputeFromGross_StandardVat_NetPlusTaxEqualsGrossExactly()
    {
        var vatPayableAccountId = Guid.NewGuid();
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            Rate = 0.18m,
            RepartitionLines = { new TaxRepartitionLine { AccountId = vatPayableAccountId, Percentage = 100m } }
        };

        var result = _service.ComputeFromGross(100m, taxDefinition);

        Assert.Equal(84.75m, result.NetAmount);
        Assert.Equal(15.25m, result.TaxAmount); // not 15.26 (naive net*rate)
        Assert.Equal(100m, result.TotalAmount);
        Assert.Equal(result.NetAmount + result.TaxAmount, result.TotalAmount);
        Assert.Single(result.PostingLines);
        Assert.Equal(15.25m, result.PostingLines[0].Amount);
    }

    [Fact]
    public void ComputeFromGross_NoTax_NetEqualsGross()
    {
        var taxDefinition = new TaxDefinition { Id = Guid.NewGuid(), Rate = 0.00m, Type = TaxType.VatExempt };

        var result = _service.ComputeFromGross(500m, taxDefinition);

        Assert.Equal(500m, result.NetAmount);
        Assert.Equal(0m, result.TaxAmount);
        Assert.Equal(500m, result.TotalAmount);
        Assert.Empty(result.PostingLines);
    }

    // Reverse-charge codes (RC18): the foreign vendor never charged VAT — the entered amount is
    // fully net regardless of the gross-entry convention. R10's AUTO self-charge calculation
    // (Invoice.Post/Bill.Post) needs the full entered amount as its base, not a backed-out
    // fraction of it, so ComputeFromGross must NOT divide for reverse-charge codes.
    [Fact]
    public void ComputeFromGross_ReverseCharge_NetEqualsGross_NotBackedOut()
    {
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            Rate = 0.18m,
            IsReverseCharge = true
        };

        var result = _service.ComputeFromGross(100m, taxDefinition);

        Assert.Equal(100m, result.NetAmount);
        Assert.Equal(0m, result.TaxAmount);
        Assert.Equal(100m, result.TotalAmount);
        Assert.Empty(result.PostingLines);
    }

    // Multi-line split (BV50-style, 50/50): the split itself must also sum exactly to the
    // remainder-based TaxAmount, not to an independently-rounded total.
    [Fact]
    public void ComputeFromGross_MultipleRepartitionLines_LastLineAbsorbsRoundingRemainder()
    {
        var accountA = Guid.NewGuid();
        var accountB = Guid.NewGuid();
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            Rate = 0.18m,
            RepartitionLines =
            {
                new TaxRepartitionLine { AccountId = accountA, Percentage = 50m },
                new TaxRepartitionLine { AccountId = accountB, Percentage = 50m }
            }
        };

        var result = _service.ComputeFromGross(100m, taxDefinition);

        Assert.Equal(84.75m, result.NetAmount);
        Assert.Equal(15.25m, result.TaxAmount);
        Assert.Equal(2, result.PostingLines.Count);
        Assert.Equal(result.TaxAmount, result.PostingLines.Sum(l => l.Amount));
        // 15.25 * 50% = 7.625 -> rounds to 7.63 for the first line; second line absorbs the
        // remainder (15.25 - 7.63 = 7.62) so the pair sums exactly, not 7.63 + 7.63 = 15.26.
        Assert.Equal(7.63m, result.PostingLines.Single(l => l.AccountId == accountA).Amount);
        Assert.Equal(7.62m, result.PostingLines.Single(l => l.AccountId == accountB).Amount);
    }

    [Fact]
    public void ComputeFromGross_MidpointCent_RoundsAwayFromZero()
    {
        var taxDefinition = new TaxDefinition
        {
            Id = Guid.NewGuid(),
            Rate = 0.10m,
            RepartitionLines = { new TaxRepartitionLine { AccountId = Guid.NewGuid(), Percentage = 100m } }
        };

        // gross 1.10 at 10% VAT: net = 1.10/1.10 = 1.00 exactly, tax = 0.10.
        var result = _service.ComputeFromGross(1.10m, taxDefinition);

        Assert.Equal(1.00m, result.NetAmount);
        Assert.Equal(0.10m, result.TaxAmount);
    }
}
