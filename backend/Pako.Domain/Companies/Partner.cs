namespace Pako.Domain.Companies;

public class Partner
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? TaxNumber { get; set; }
    public bool IsCustomer { get; set; }
    public bool IsVendor { get; set; }

    // S0.3 (Sprint 0 registers, additive/inert): natural-person identifier, distinct from
    // TaxNumber (the business tax number) — Track B5's "with/without-VAT distinction" wiring.
    public string? FiscalNumber { get; set; }
    public bool IsVatRegistered { get; set; }
}
