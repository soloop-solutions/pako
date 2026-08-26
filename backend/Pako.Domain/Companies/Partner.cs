namespace Pako.Domain.Companies;

public class Partner
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? TaxNumber { get; set; }
    public bool IsCustomer { get; set; }
    public bool IsVendor { get; set; }
}
