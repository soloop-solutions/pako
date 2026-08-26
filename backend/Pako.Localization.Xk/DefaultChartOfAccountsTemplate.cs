using Pako.Domain.Ledger;

namespace Pako.Localization.Xk;

public record ChartOfAccountsTemplateEntry(string Code, string Name, AccountType AccountType, AccountSubType AccountSubType);

public static class DefaultChartOfAccountsTemplate
{
    public const string AccountsReceivableCode = "1200";
    public const string AccountsPayableCode = "2000";
    public const string DefaultRevenueAccountCode = "4000";
    public const string DefaultExpenseAccountCode = "6000";
    public const string SalaryExpenseAccountCode = "6100";
    public const string PitPayableAccountCode = "2200";
    public const string PensionPayableAccountCode = "2300";
    public const string NetPayPayableAccountCode = "2400";

    // Kosovo law (06/L-032) mandates IFRS/IFRS-for-SMEs categories only, not a numbered chart
    // of accounts. This numbering is a design choice for a starting seed, not a legal requirement.
    public static readonly IReadOnlyList<ChartOfAccountsTemplateEntry> Entries = new List<ChartOfAccountsTemplateEntry>
    {
        new("1000", "Cash", AccountType.Asset, AccountSubType.Cash),
        new("1010", "Bank", AccountType.Asset, AccountSubType.Bank),
        new("1200", "Accounts Receivable", AccountType.Asset, AccountSubType.Receivable),
        new("1300", "VAT Receivable", AccountType.Asset, AccountSubType.None),
        new("2000", "Accounts Payable", AccountType.Liability, AccountSubType.Payable),
        new("2100", "VAT Payable", AccountType.Liability, AccountSubType.None),
        new("2200", "PIT Payable", AccountType.Liability, AccountSubType.None),
        new("2300", "Pension Payable", AccountType.Liability, AccountSubType.None),
        new("2400", "Net Pay Payable", AccountType.Liability, AccountSubType.None),
        new("3000", "Share Capital", AccountType.Equity, AccountSubType.None),
        new("3900", "Retained Earnings", AccountType.Equity, AccountSubType.None),
        new("4000", "Sales Revenue", AccountType.Income, AccountSubType.None),
        new("5000", "Cost of Goods Sold", AccountType.Expense, AccountSubType.None),
        new("6000", "Operating Expenses", AccountType.Expense, AccountSubType.None),
        new("6100", "Salary Expense", AccountType.Expense, AccountSubType.None)
    };
}
