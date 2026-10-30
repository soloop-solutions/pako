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

    // --- Comprehensive salary calculation tests ---

    [Theory]
    [InlineData(100, 5.00, 5.00, 0.00, 95.00)]       // fully in 0% bracket
    [InlineData(250, 12.50, 12.50, 0.00, 237.50)]     // fully in 0% bracket
    [InlineData(400, 20.00, 20.00, 10.40, 369.60)]    // crosses into 8% bracket
    [InlineData(800, 40.00, 40.00, 47.00, 713.00)]    // crosses into 10% bracket
    [InlineData(1000, 50.00, 50.00, 66.00, 884.00)]   // well into 10% bracket
    [InlineData(1500, 75.00, 75.00, 113.50, 1311.50)] // well into 10% bracket
    [InlineData(3000, 150.00, 150.00, 256.00, 2594.00)] // high salary
    public void Compute_VariousGrossSalaries_MatchIndependentCalculation(
        double grossD, double expectedEePensionD, double expectedErPensionD, double expectedPitD, double expectedNetD)
    {
        var gross = (decimal)grossD;
        var result = _service.Compute(gross, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal((decimal)expectedEePensionD, result.EmployeePensionAmount);
        Assert.Equal((decimal)expectedErPensionD, result.EmployerPensionAmount);
        Assert.Equal((decimal)expectedPitD, result.PitAmount);
        Assert.Equal((decimal)expectedNetD, result.NetPay);
        Assert.Equal(gross, result.GrossSalary);
        Assert.Equal(gross, result.NetPay + result.PitAmount + result.EmployeePensionAmount);
    }

    [Fact]
    public void Compute_ZeroGross_AllZero()
    {
        var result = _service.Compute(0m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(0m, result.GrossSalary);
        Assert.Equal(0m, result.EmployeePensionAmount);
        Assert.Equal(0m, result.EmployerPensionAmount);
        Assert.Equal(0m, result.PitAmount);
        Assert.Equal(0m, result.NetPay);
    }

    [Fact]
    public void Compute_BracketBoundary_AnnualTaxableExactly3000_NoPit()
    {
        // gross * 0.95 * 12 = 3000 → gross = 3000 / 12 / 0.95 = 263.157894...
        // Use 263.16 which gives annual taxable = (263.16 - Round(263.16*0.05,2)) * 12
        //   = (263.16 - 13.16) * 12 = 250.00 * 12 = 3000.00 → exactly at boundary, 0% PIT
        var result = _service.Compute(263.16m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(13.16m, result.EmployeePensionAmount);
        Assert.Equal(0m, result.PitAmount);
    }

    [Fact]
    public void Compute_BracketBoundary_AnnualTaxableJustAbove3000_SmallPit()
    {
        // 263.17 → pension = Round(263.17*0.05, 2) = 13.16, taxable monthly = 250.01
        // annual = 3000.12, bracket 2: (3000.12-3000)*0.08 = 0.0096, annual PIT = Round(0.0096,2) = 0.01
        // monthly PIT = Round(0.01/12, 2) = 0.00 (rounds to zero at monthly level)
        var result = _service.Compute(263.17m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(13.16m, result.EmployeePensionAmount);
        // Annual PIT is 0.01 but monthly is 0.01/12 = 0.00 after rounding
        Assert.Equal(0.00m, result.PitAmount);
    }

    [Fact]
    public void Compute_BracketBoundary_NoCentGapAtThresholds()
    {
        // Verify that income at exactly the annual threshold boundary is handled correctly.
        // With brackets at [0,3000), [3000,5400), [5400,+∞), there must be no gap.
        // A gross that places annual taxable at 3000.01 must produce non-zero annual PIT.
        var brackets = new List<PitBracket>
        {
            new(0m, 3000m, 0.00m),
            new(3000m, 5400m, 0.08m),
            new(5400m, null, 0.10m)
        };

        // Directly test the progressive algorithm with annual income just above 3000
        // monthlyGross = 250.10 → pension = 12.51, taxable = 237.59, annual = 2851.08 → still in 0%
        // We need to test with a value whose annual taxable is exactly 3001
        // annual taxable = 3001 → monthly taxable = 250.0833 → gross = 250.0833/0.95 = 263.245...
        // Instead, test with hand-crafted brackets directly:
        var result = _service.Compute(3001m / 12m / 0.95m, brackets, 0.05m, 0.05m);
        // The annual taxable should be around 3001; the key assertion is PIT > 0
        // But rounding makes this imprecise, so let's use a simpler approach:

        // Use a salary high enough that annual taxable is clearly 3001
        // monthlyGross such that (gross - Round(gross*0.05,2)) * 12 > 3000
        // gross = 264 → pension = 13.20, taxable = 250.80, annual = 3009.60
        var result2 = _service.Compute(264m, brackets, 0.05m, 0.05m);
        // Annual PIT = (3009.60 - 3000) * 0.08 = 9.60 * 0.08 = 0.768, rounds to 0.77
        // Monthly PIT = 0.77 / 12 = 0.0641..., rounds to 0.06
        Assert.True(result2.PitAmount > 0m,
            $"Income just above the 8% threshold must produce non-zero PIT, but got {result2.PitAmount}");
    }

    [Fact]
    public void Compute_DecimalGross_RoundingHandledCorrectly()
    {
        // 333.33 → pension = Round(333.33*0.05, 2) = Round(16.6665, 2) = 16.67
        // taxable monthly = 316.66, annual = 3799.92
        // bracket 2: (3799.92 - 3000) * 0.08 = 799.92 * 0.08 = 63.9936
        // annual PIT = Round(63.9936, 2) = 63.99
        // monthly PIT = Round(63.99/12, 2) = Round(5.3325, 2) = 5.33
        // net = 333.33 - 5.33 - 16.67 = 311.33
        var result = _service.Compute(333.33m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(16.67m, result.EmployeePensionAmount);
        Assert.Equal(16.67m, result.EmployerPensionAmount);
        Assert.Equal(5.33m, result.PitAmount);
        Assert.Equal(311.33m, result.NetPay);
        Assert.Equal(333.33m, result.NetPay + result.PitAmount + result.EmployeePensionAmount);
    }

    [Fact]
    public void Compute_VeryLargeGross_HandledCorrectly()
    {
        // 50000 → pension = 2500, taxable monthly = 47500, annual = 570000
        // bracket 2: 2400 * 0.08 = 192
        // bracket 3: (570000 - 5400) * 0.10 = 564600 * 0.10 = 56460
        // annual PIT = 56652, monthly = 56652/12 = 4721.00
        // net = 50000 - 4721 - 2500 = 42779
        var result = _service.Compute(50000m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(2500m, result.EmployeePensionAmount);
        Assert.Equal(2500m, result.EmployerPensionAmount);
        Assert.Equal(4721m, result.PitAmount);
        Assert.Equal(42779m, result.NetPay);
    }

    [Fact]
    public void Compute_NegativeGross_ProducesNegativeResults()
    {
        // The service doesn't validate; the controller rejects salary <= 0.
        // Verify the math is at least consistent (no crash, identity holds).
        var result = _service.Compute(-100m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(-100m, result.GrossSalary);
        Assert.Equal(-100m, result.NetPay + result.PitAmount + result.EmployeePensionAmount);
    }

    [Fact]
    public void Compute_EmployerPensionDoesNotAffectNetPay()
    {
        var result = _service.Compute(1000m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        // Employer pension is an additional cost, NOT deducted from net pay
        Assert.Equal(1000m, result.NetPay + result.PitAmount + result.EmployeePensionAmount);
        // Employer pension is separate
        Assert.Equal(50m, result.EmployerPensionAmount);
    }

    [Fact]
    public void Compute_PensionDeductedBeforePit()
    {
        // Verify that employee pension is deducted from gross before computing PIT.
        // For gross = 400: taxable = 400 - 20 = 380, NOT 400.
        // Annual taxable = 4560 (not 4800).
        // If pension were NOT deducted: annual taxable = 4800, PIT = (4800-3000)*0.08 = 144,
        //   monthly PIT = 12.00
        // With pension deducted: annual taxable = 4560, PIT = (4560-3000)*0.08 = 124.80,
        //   monthly PIT = 10.40
        var result = _service.Compute(400m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(10.40m, result.PitAmount); // NOT 12.00
    }

    // ======================================================================
    // AUDIT TEST MATRIX — Full salary calculator audit (ticket requirement)
    //
    // Independent reference calculation per Kosovo Law 08/L-142 (effective 2024-08-23):
    //   Employee pension = Round(gross * 0.05, 2, AwayFromZero)
    //   Employer pension = Round(gross * 0.05, 2, AwayFromZero)
    //   Taxable monthly = gross - employee pension
    //   Annual taxable = taxable monthly * 12
    //   Annual PIT (progressive):
    //     [0, 3000)   → 0%
    //     [3000, 5400) → 8%
    //     [5400, ∞)   → 10%
    //   Monthly PIT = Round(annual PIT / 12, 2, AwayFromZero)
    //   Net = gross - employee pension - monthly PIT
    //   Employer cost = gross + employer pension
    //
    // Sources:
    //   - PwC Tax Summaries (Kosovo, Individual, reviewed 2026-08-07)
    //   - ATK notice "Personal Income Tax rates are changed" (2024-08-23)
    //   - KosovoPensionContribution: 5% ee / 5% er (Law 04/L-101)
    // ======================================================================

    [Theory]
    // Full audit matrix: gross → eePension, erPension, PIT, net, employerCost
    //   €0:    all zero
    [InlineData(0,        0.00,    0.00,    0.00,     0.00,      0.00)]
    //   €50:   annual taxable = 570 → 0% bracket
    [InlineData(50,       2.50,    2.50,    0.00,    47.50,     52.50)]
    //   €100:  annual taxable = 1140 → 0% bracket
    [InlineData(100,      5.00,    5.00,    0.00,    95.00,    105.00)]
    //   €150:  annual taxable = 1710 → 0% bracket
    [InlineData(150,      7.50,    7.50,    0.00,   142.50,    157.50)]
    //   €200:  annual taxable = 2280 → 0% bracket
    [InlineData(200,     10.00,   10.00,    0.00,   190.00,    210.00)]
    //   €250:  annual taxable = 2850 → 0% bracket
    [InlineData(250,     12.50,   12.50,    0.00,   237.50,    262.50)]
    //   €300:  taxable=285/mo, annual=3420, PIT=(420*0.08)=33.60/yr, 2.80/mo
    [InlineData(300,     15.00,   15.00,    2.80,   282.20,    315.00)]
    //   €400:  taxable=380/mo, annual=4560, PIT=(1560*0.08)=124.80/yr, 10.40/mo
    [InlineData(400,     20.00,   20.00,   10.40,   369.60,    420.00)]
    //   €450:  taxable=427.50/mo, annual=5130, PIT=(2130*0.08)=170.40/yr, 14.20/mo
    [InlineData(450,     22.50,   22.50,   14.20,   413.30,    472.50)]
    //   €500:  taxable=475/mo, annual=5700, PIT=(2400*0.08)+(300*0.10)=222/yr, 18.50/mo
    [InlineData(500,     25.00,   25.00,   18.50,   456.50,    525.00)]
    //   €600:  taxable=570/mo, annual=6840, PIT=(2400*0.08)+(1440*0.10)=336/yr, 28.00/mo
    [InlineData(600,     30.00,   30.00,   28.00,   542.00,    630.00)]
    //   €800:  taxable=760/mo, annual=9120, PIT=(2400*0.08)+(3720*0.10)=564/yr, 47.00/mo
    [InlineData(800,     40.00,   40.00,   47.00,   713.00,    840.00)]
    //   €1000: taxable=950/mo, annual=11400, PIT=(2400*0.08)+(6000*0.10)=792/yr, 66.00/mo
    [InlineData(1000,    50.00,   50.00,   66.00,   884.00,   1050.00)]
    //   €1500: taxable=1425/mo, annual=17100, PIT=(2400*0.08)+(11700*0.10)=1362/yr, 113.50/mo
    [InlineData(1500,    75.00,   75.00,  113.50,  1311.50,   1575.00)]
    //   €2000: taxable=1900/mo, annual=22800, PIT=(2400*0.08)+(17400*0.10)=1932/yr, 161.00/mo
    [InlineData(2000,   100.00,  100.00,  161.00,  1739.00,   2100.00)]
    //   €3000: taxable=2850/mo, annual=34200, PIT=(2400*0.08)+(28800*0.10)=3072/yr, 256.00/mo
    [InlineData(3000,   150.00,  150.00,  256.00,  2594.00,   3150.00)]
    //   €5000: taxable=4750/mo, annual=57000, PIT=(2400*0.08)+(51600*0.10)=5352/yr, 446.00/mo
    [InlineData(5000,   250.00,  250.00,  446.00,  4304.00,   5250.00)]
    //   €10000: taxable=9500/mo, annual=114000, PIT=(2400*0.08)+(108600*0.10)=11052/yr, 921.00/mo
    [InlineData(10000,  500.00,  500.00,  921.00,  8579.00,  10500.00)]
    public void Audit_FullSalaryMatrix_MatchesIndependentCalculation(
        double grossD, double eePensionD, double erPensionD, double pitD, double netD, double employerCostD)
    {
        var gross = (decimal)grossD;
        var result = _service.Compute(gross, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal((decimal)eePensionD, result.EmployeePensionAmount);
        Assert.Equal((decimal)erPensionD, result.EmployerPensionAmount);
        Assert.Equal((decimal)pitD, result.PitAmount);
        Assert.Equal((decimal)netD, result.NetPay);
        Assert.Equal(gross, result.GrossSalary);
        // Identity: gross = net + PIT + employee pension
        Assert.Equal(gross, result.NetPay + result.PitAmount + result.EmployeePensionAmount);
        // Employer cost = gross + employer pension
        Assert.Equal((decimal)employerCostD, result.GrossSalary + result.EmployerPensionAmount);
    }

    // --- Bracket boundary tests (taxable-income thresholds, not gross) ---

    [Fact]
    public void Audit_Boundary_AnnualTaxable5400_ExactlyAtSecondThreshold()
    {
        // Monthly taxable = 450.00, gross = 450 / 0.95 = 473.6842...
        // 473.68 → pension = Round(473.68*0.05,2) = 23.684 → 23.68, taxable = 450.00
        // annual = 5400.00, PIT = 2400 * 0.08 = 192.00, monthly = 16.00
        var result = _service.Compute(473.68m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(23.68m, result.EmployeePensionAmount);
        Assert.Equal(16.00m, result.PitAmount);
        Assert.Equal(434.00m, result.NetPay);
    }

    [Fact]
    public void Audit_Boundary_AnnualTaxableJustAbove5400()
    {
        // 473.69 → pension = Round(473.69*0.05,2) = 23.6845 → 23.68
        // taxable = 450.01, annual = 5400.12
        // PIT = 2400*0.08 + 0.12*0.10 = 192 + 0.012 = 192.012, rounds to 192.01
        // monthly = Round(192.01/12, 2) = Round(16.000833, 2) = 16.00
        var result = _service.Compute(473.69m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(23.68m, result.EmployeePensionAmount);
        Assert.Equal(16.00m, result.PitAmount); // rounding absorbs tiny threshold crossing
    }

    [Fact]
    public void Audit_Boundary_GrossOneEuroCent()
    {
        // 0.01 → pension = Round(0.01*0.05,2) = Round(0.0005,2) = 0.00
        // taxable = 0.01, annual = 0.12, PIT = 0
        // net = 0.01
        var result = _service.Compute(0.01m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(0.00m, result.EmployeePensionAmount);
        Assert.Equal(0.00m, result.PitAmount);
        Assert.Equal(0.01m, result.NetPay);
    }

    [Fact]
    public void Audit_Boundary_ThreeDecimalPlaceGross()
    {
        // The service rounds gross to 2 decimals: 999.999 → 1000.00
        // 1000.00 → pension = 50.00, taxable = 950, PIT = 66.00, net = 884.00
        var result = _service.Compute(999.999m, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);

        Assert.Equal(50.00m, result.EmployeePensionAmount);
        Assert.Equal(66.00m, result.PitAmount);
        Assert.Equal(884.00m, result.NetPay);
    }

    // --- Kosovo-specific rule verification ---

    [Fact]
    public void Audit_KosovoBrackets_MatchLaw08L142()
    {
        // Law 08/L-142 (effective 2024-08-23): three brackets, annual
        var brackets = KosovoPersonalIncomeTaxBrackets.Brackets;
        Assert.Equal(3, brackets.Count);

        Assert.Equal(0m, brackets[0].LowerBoundEurPerYear);
        Assert.Equal(3000m, brackets[0].UpperBoundEurPerYear);
        Assert.Equal(0.00m, brackets[0].Rate);

        Assert.Equal(3000m, brackets[1].LowerBoundEurPerYear);
        Assert.Equal(5400m, brackets[1].UpperBoundEurPerYear);
        Assert.Equal(0.08m, brackets[1].Rate);

        Assert.Equal(5400m, brackets[2].LowerBoundEurPerYear);
        Assert.Null(brackets[2].UpperBoundEurPerYear);
        Assert.Equal(0.10m, brackets[2].Rate);
    }

    [Fact]
    public void Audit_KosovoPensionRates_Match5Percent()
    {
        Assert.Equal(0.05m, KosovoPensionContribution.EmployeeRate);
        Assert.Equal(0.05m, KosovoPensionContribution.EmployerRate);
    }

    // --- Identity invariant: fuzz test across wide range ---

    [Fact]
    public void Audit_GrossEqualsNetPlusPitPlusEmployeePension_ForAllTestSalaries()
    {
        var salaries = new[]
        {
            0m, 0.01m, 0.50m, 1m, 10m, 50m, 100m, 150m, 200m, 250m, 263.16m, 263.17m, 264m,
            300m, 333.33m, 400m, 450m, 473.68m, 473.69m, 500m, 600m, 750m, 800m, 999.99m, 1000m,
            1200m, 1500m, 2000m, 2500m, 3000m, 5000m, 10000m, 50000m, 100000m
        };

        foreach (var gross in salaries)
        {
            var r = _service.Compute(gross, Brackets, KosovoPensionContribution.EmployeeRate, KosovoPensionContribution.EmployerRate);
            Assert.Equal(gross, r.NetPay + r.PitAmount + r.EmployeePensionAmount);
        }
    }
}
