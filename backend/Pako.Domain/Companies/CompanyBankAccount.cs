namespace Pako.Domain.Companies;

public class CompanyBankAccount
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string BankName { get; set; } = string.Empty;
    public string? AccountHolder { get; set; }
    public string? Iban { get; set; }
    public string? SwiftBic { get; set; }
    public bool IsDefault { get; set; }
    public int SortOrder { get; set; }
}
