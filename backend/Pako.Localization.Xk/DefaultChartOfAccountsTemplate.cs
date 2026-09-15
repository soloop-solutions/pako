using Pako.Domain.Ledger;

namespace Pako.Localization.Xk;

public record ChartOfAccountsTemplateEntry(string Code, string Name, AccountType AccountType, AccountSubType AccountSubType);

// Stage-0 placeholder chart, superseded for real company creation by ChartOfAccountsV2Template
// (COA_V2_IMPLEMENTATION_BRIEF.md Stage 2) — CompaniesController.Create no longer seeds from
// here. Kept only because Pako.Tests/ReportsControllerTests.cs still builds its own fixture
// company from this smaller, simpler 16-account set; the *Code constants that used to be looked
// up by InvoicesController/BillsController/PayrollRunsController/ReconciliationCreator were
// removed as part of that Stage 2 refactor (account resolution now goes through
// CompanyAccountDefaults, not a literal code string).
public static class DefaultChartOfAccountsTemplate
{
    // Kosovo law (06/L-032) mandates IFRS/IFRS-for-SMEs categories only, not a numbered chart
    // of accounts. This numbering is a design choice for a starting seed, not a legal requirement.
    public static readonly IReadOnlyList<ChartOfAccountsTemplateEntry> Entries = new List<ChartOfAccountsTemplateEntry>
    {
        new("1000", "Cash", AccountType.Cash, AccountSubType.Cash),
        new("1010", "Bank", AccountType.Cash, AccountSubType.Bank),
        new("1200", "Accounts Receivable", AccountType.Receivable, AccountSubType.Receivable),
        new("1300", "VAT Receivable", AccountType.CurrentAsset, AccountSubType.None),
        new("2000", "Accounts Payable", AccountType.Payable, AccountSubType.Payable),
        new("2100", "VAT Payable", AccountType.CurrentLiability, AccountSubType.None),
        new("2200", "PIT Payable", AccountType.CurrentLiability, AccountSubType.None),
        new("2300", "Pension Payable", AccountType.CurrentLiability, AccountSubType.None),
        new("2400", "Net Pay Payable", AccountType.CurrentLiability, AccountSubType.None),
        new("2500", "Customer Deposits", AccountType.CurrentLiability, AccountSubType.None),
        new("3000", "Share Capital", AccountType.Equity, AccountSubType.None),
        new("3900", "Retained Earnings", AccountType.Equity, AccountSubType.None),
        new("4000", "Sales Revenue", AccountType.Income, AccountSubType.None),
        new("5000", "Cost of Goods Sold", AccountType.CostOfRevenue, AccountSubType.None),
        new("6000", "Operating Expenses", AccountType.Expense, AccountSubType.None),
        new("6100", "Salary Expense", AccountType.Expense, AccountSubType.None)
    };
}
