namespace Pako.Domain.Ledger;

public enum AccountType
{
    Asset,
    Liability,
    Equity,
    Income,
    Expense
}

public enum AccountSubType
{
    None,
    Receivable,
    Payable,
    Bank,
    Cash
}

public class Account
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public AccountType AccountType { get; set; }
    public AccountSubType AccountSubType { get; set; } = AccountSubType.None;
    public Guid? ParentAccountId { get; set; }
    public bool IsReconcilable { get; set; }
}
