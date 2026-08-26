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
}
