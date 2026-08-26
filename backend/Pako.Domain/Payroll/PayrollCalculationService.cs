namespace Pako.Domain.Payroll;

public record PitBracket(decimal LowerBound, decimal? UpperBound, decimal Rate);

public record PayslipCalculationResult(
    decimal GrossSalary,
    decimal PitAmount,
    decimal EmployeePensionAmount,
    decimal EmployerPensionAmount,
    decimal NetPay);

public interface IPayrollCalculationService
{
    PayslipCalculationResult Compute(
        decimal monthlyGrossSalary,
        IReadOnlyList<PitBracket> annualPitBrackets,
        decimal employeePensionRate,
        decimal employerPensionRate);
}

// Kept country-agnostic, same reason ITaxComputationService/TaxComputationService don't reference
// Pako.Localization.Xk directly: the caller (Pako.Api, which already depends on Xk) supplies the
// Kosovo bracket/pension numbers per call, the same way Xk's DefaultTaxDefinitionsTemplate feeds
// Kosovo rates into TaxDefinition rows rather than Domain importing them itself.
//
// annualPitBrackets is denominated per year (matching KosovoPersonalIncomeTaxBrackets' own field
// naming). This annualizes the monthly taxable salary (x12), applies the brackets progressively,
// then divides the resulting annual tax by 12 for the month's withholding — mathematically
// identical to scaling the bracket bounds down to monthly and applying them directly, for a salary
// that is constant across the year, which is the assumption Employee.MonthlyGrossSalary already
// bakes in (one fixed monthly figure, not a per-run amount). The employee's pension contribution
// is treated as deductible before PIT is computed (taxable base = gross - employee pension),
// matching common practice for mandatory pension contributions but NOT verified against ATK's
// primary wage-withholding guidance — same NeedsLegalVerification caveat
// Pako.Localization.Xk.KosovoPensionContribution already carries.
public class PayrollCalculationService : IPayrollCalculationService
{
    public PayslipCalculationResult Compute(
        decimal monthlyGrossSalary,
        IReadOnlyList<PitBracket> annualPitBrackets,
        decimal employeePensionRate,
        decimal employerPensionRate)
    {
        var employeePension = Math.Round(monthlyGrossSalary * employeePensionRate, 2, MidpointRounding.AwayFromZero);
        var employerPension = Math.Round(monthlyGrossSalary * employerPensionRate, 2, MidpointRounding.AwayFromZero);

        var taxableMonthly = monthlyGrossSalary - employeePension;
        var annualPit = ComputeAnnualPit(taxableMonthly * 12m, annualPitBrackets);
        var pit = Math.Round(annualPit / 12m, 2, MidpointRounding.AwayFromZero);

        var netPay = monthlyGrossSalary - pit - employeePension;

        return new PayslipCalculationResult(monthlyGrossSalary, pit, employeePension, employerPension, netPay);
    }

    private static decimal ComputeAnnualPit(decimal annualTaxableIncome, IReadOnlyList<PitBracket> brackets)
    {
        var tax = 0m;
        foreach (var bracket in brackets)
        {
            if (annualTaxableIncome <= bracket.LowerBound)
            {
                continue;
            }

            var upper = bracket.UpperBound is { } bound ? Math.Min(bound, annualTaxableIncome) : annualTaxableIncome;
            var widthTaxed = upper - bracket.LowerBound;
            if (widthTaxed > 0m)
            {
                tax += widthTaxed * bracket.Rate;
            }
        }

        return Math.Round(tax, 2, MidpointRounding.AwayFromZero);
    }
}
