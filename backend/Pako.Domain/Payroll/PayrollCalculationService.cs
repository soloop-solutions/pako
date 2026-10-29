namespace Pako.Domain.Payroll;

public record PitBracket(decimal LowerBound, decimal? UpperBound, decimal Rate);

public record PayslipCalculationResult(
    decimal GrossSalary,
    decimal PitAmount,
    decimal EmployeePensionAmount,
    decimal EmployerPensionAmount,
    decimal NetPay);

// What one employee's slip is computed from. BaseSalary is already prorated for the period;
// TaxableAdditions are bonuses/overtime/allowances (added to gross, taxed and pensioned);
// Deductions come out of net after tax.
public record PayslipInput(
    decimal BaseSalary,
    decimal TaxableAdditions = 0m,
    decimal Deductions = 0m,
    bool IsPrimaryEmployer = true,
    bool PensionExempt = false);

// Statutory parameters, supplied by the caller from Pako.Localization.Xk.
public record PayrollStatutoryRates(
    IReadOnlyList<PitBracket> AnnualPitBrackets,
    decimal EmployeePensionRate,
    decimal EmployerPensionRate,
    decimal SecondaryEmployerFlatRate);

public record PayslipComputation(
    decimal BaseSalary,
    decimal Additions,
    decimal GrossSalary,
    decimal PitAmount,
    decimal EmployeePensionAmount,
    decimal EmployerPensionAmount,
    decimal Deductions,
    decimal NetPay);

public interface IPayrollCalculationService
{
    PayslipCalculationResult Compute(
        decimal monthlyGrossSalary,
        IReadOnlyList<PitBracket> annualPitBrackets,
        decimal employeePensionRate,
        decimal employerPensionRate);

    PayslipComputation Compute(PayslipInput input, PayrollStatutoryRates rates);
}

// Kept country-agnostic, same reason ITaxComputationService/TaxComputationService don't reference
// Pako.Localization.Xk directly: the caller (Pako.Api, which already depends on Xk) supplies the
// Kosovo bracket/pension numbers per call, the same way Xk's DefaultTaxDefinitionsTemplate feeds
// Kosovo rates into TaxDefinition rows rather than Domain importing them itself.
//
// annualPitBrackets is denominated per year (matching KosovoPersonalIncomeTaxBrackets' own field
// naming). This annualizes the monthly taxable salary (x12), applies the brackets progressively,
// then divides the resulting annual tax by 12 for the month's withholding — mathematically
// identical to applying the monthly bands (250 / 450) directly, which is how ATK withholding
// works month by month, bonuses included. The employee's pension contribution is treated as
// deductible before PIT is computed (taxable base = gross - employee pension) — same
// NeedsLegalVerification caveat Pako.Localization.Xk.KosovoPensionContribution already carries.
//
// A secondary employer withholds SecondaryEmployerFlatRate on the whole taxable base, with no
// 0% band (Law 08/L-142; also NeedsLegalVerification).
public class PayrollCalculationService : IPayrollCalculationService
{
    public PayslipCalculationResult Compute(
        decimal monthlyGrossSalary,
        IReadOnlyList<PitBracket> annualPitBrackets,
        decimal employeePensionRate,
        decimal employerPensionRate)
    {
        var result = Compute(
            new PayslipInput(monthlyGrossSalary),
            new PayrollStatutoryRates(annualPitBrackets, employeePensionRate, employerPensionRate, 0m));

        return new PayslipCalculationResult(
            result.GrossSalary, result.PitAmount, result.EmployeePensionAmount, result.EmployerPensionAmount, result.NetPay);
    }

    public PayslipComputation Compute(PayslipInput input, PayrollStatutoryRates rates)
    {
        var baseSalary = Round(input.BaseSalary);
        var additions = Round(input.TaxableAdditions);
        var deductions = Round(input.Deductions);
        var gross = baseSalary + additions;

        var employeePension = input.PensionExempt ? 0m : Round(gross * rates.EmployeePensionRate);
        var employerPension = input.PensionExempt ? 0m : Round(gross * rates.EmployerPensionRate);

        var taxableMonthly = gross - employeePension;
        var pit = input.IsPrimaryEmployer
            ? Round(ComputeAnnualPit(taxableMonthly * 12m, rates.AnnualPitBrackets) / 12m)
            : Round(Math.Max(taxableMonthly, 0m) * rates.SecondaryEmployerFlatRate);

        var netPay = gross - pit - employeePension - deductions;

        return new PayslipComputation(baseSalary, additions, gross, pit, employeePension, employerPension, deductions, netPay);
    }

    private static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

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
