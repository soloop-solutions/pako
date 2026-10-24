namespace Pako.Domain.Tax;

/// <summary>
/// Centralized VAT eligibility validation — determines whether a given tax code is appropriate
/// for a company based on its VAT registration status and the tax code's classification.
///
/// Kosovo VAT Law (Law No. 05/L-037):
///  - Art. 6(8): A non-VAT-registered person must not charge VAT.
///  - Art. 35(1): Only a VAT-registered person may deduct input VAT.
///  - Art. 41: Invoice requirements include seller's VAT number.
///
/// This validator does NOT check by rate alone (Rate > 0 is insufficient because zero-rated,
/// exempt, reverse-charge, and withholding codes have distinct legal meanings). Instead it
/// checks the code's Direction and classification:
///
///  - A non-VAT company may use: NA (not applicable) and codes with Direction.None.
///  - A non-VAT company may NOT use: any code with Direction Out/In/Imp/Rc (these are
///    VAT-mechanism codes that create output VAT, claim input VAT, or trigger reverse charge).
///  - Withholding codes (WHT-*) are separate from VAT and are allowed regardless of VAT status
///    since withholding tax obligations exist independently of VAT registration.
///
/// Called from BuildAndValidateLinesAsync in both InvoicesController and BillsController.
/// </summary>
public static class VatEligibilityValidator
{
    /// <summary>
    /// Returns true if the given tax definition is eligible for use by a company with the
    /// specified VAT registration status.
    /// </summary>
    public static bool IsEligible(bool companyIsVatRegistered, TaxDefinition taxDefinition)
    {
        // VAT-registered companies can use all tax codes.
        if (companyIsVatRegistered)
            return true;

        // Non-VAT companies: allow withholding codes (WHT-*) — withholding tax is independent of VAT.
        if (taxDefinition.Type == TaxType.Withholding)
            return true;

        // Non-VAT companies: allow NA (not applicable) — the explicit "no VAT mechanics" code.
        if (taxDefinition.Code == "NA")
            return true;

        // Non-VAT companies: allow codes with Direction.None — these have no VAT mechanism.
        if (taxDefinition.Direction == TaxDirection.None)
            return true;

        // Non-VAT companies: block all VAT-mechanism codes (Out, In, Imp, Rc).
        // These would create output VAT, claim input VAT deductions, or trigger reverse charge —
        // all of which require VAT registration.
        return false;
    }

    /// <summary>
    /// Returns a human-readable reason why the code is ineligible, or null if eligible.
    /// </summary>
    public static string? GetIneligibilityReason(bool companyIsVatRegistered, TaxDefinition taxDefinition)
    {
        if (IsEligible(companyIsVatRegistered, taxDefinition))
            return null;

        return taxDefinition.Direction switch
        {
            TaxDirection.Out => "VatCodeNotEligible_OutputVat",
            TaxDirection.In => "VatCodeNotEligible_InputVat",
            TaxDirection.Imp => "VatCodeNotEligible_ImportVat",
            TaxDirection.Rc => "VatCodeNotEligible_ReverseCharge",
            _ => "VatCodeNotEligible_General"
        };
    }
}
