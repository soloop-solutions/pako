namespace Pako.Domain.Payroll;

public enum CommissionBasis
{
    // Posted sales invoices (net of VAT) dated in the period, less credit notes and returns.
    InvoicedNet,

    // Customer payments matched to invoices in the period, prorated to the invoices' net — pays
    // commission only on cash actually collected.
    PaidNet,

    // docs/POS_PLAN.md P4: services the employee performed at the till (net of VAT), less returns.
    PosServicesNet
}

// G11: how an employee earns commission on the partners assigned to them.
public class CommissionPlan
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public CommissionBasis Basis { get; set; } = CommissionBasis.InvoicedNet;

    // Fraction: 0.03 = 3%.
    public decimal Rate { get; set; }

    // Nothing is paid for a month whose basis stays below this.
    public decimal? MinThreshold { get; set; }
    public bool IsActive { get; set; } = true;

    public decimal CommissionFor(decimal basis)
    {
        if (basis <= 0m || (MinThreshold is { } min && basis < min)) return 0m;
        return Math.Round(basis * Rate, 2, MidpointRounding.AwayFromZero);
    }
}
