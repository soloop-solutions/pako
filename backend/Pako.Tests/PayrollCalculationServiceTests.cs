using Pako.Domain.Payroll;
using Pako.Localization.Xk;

namespace Pako.Tests;

public class PayrollCalculationServiceTests
{
    private readonly PayrollCalculationService _service = new();

    private static readonly IReadOnlyList<PitBracket> Brackets = KosovoPersonalIncomeTaxBrackets.Brackets
        .Select(b => new PitBracket(b.LowerBoundEurPerYear, b.UpperBoundEurPerYear, b.Rate))
        .ToList();

    [Fact]
    public void Compute_SalaryFullyWithinZeroRateBracket_HasNoPit()
    {
        var result = _service.Compute(200m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(200m, result.GrossSalary);
        Assert.Equal(10m, result.EmployeePensionAmount);
        Assert.Equal(10m, result.EmployerPensionAmount);
        Assert.Equal(0m, result.PitAmount);
        Assert.Equal(190m, result.NetPay);
    }

    [Fact]
    public void Compute_SalaryCrossingBothNonZeroBrackets_MatchesExpectedProgressiveTax()
    {
        var result = _service.Compute(500m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(25m, result.EmployeePensionAmount);
        Assert.Equal(25m, result.EmployerPensionAmount);
        Assert.Equal(18.50m, result.PitAmount);
        Assert.Equal(456.50m, result.NetPay);
    }

    [Fact]
    public void Compute_NetPayPlusDeductionsAlwaysEqualsGross()
    {
        foreach (var gross in new[] { 150m, 300m, 500m, 1200m, 5000m })
        {
            var result = _service.Compute(gross, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

            Assert.Equal(gross, result.NetPay + result.PitAmount + result.EmployeePensionAmount);
        }
    }
}
