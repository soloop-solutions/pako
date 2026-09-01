namespace Pako.Domain.Companies;

// Replaces the old lookup-by-literal-code pattern (DefaultChartOfAccountsTemplate.
// AccountsReceivableCode == "1200", etc.) that broke once accounts moved to Plani Kontabel
// v2.0's 6-digit codes (COA_V2_IMPLEMENTATION_BRIEF.md Stage 2's "breaking change to fix").
// One row per company, populated at company-creation time from the just-seeded v2 chart —
// resolving AR/AP/revenue/etc. by role (a stored AccountId), not by re-deriving a code string
// at every use site.
//
// Receivable/Payable/Revenue/Expense/CustomerDeposits are CORE-profile accounts, always seeded
// for every company, so they're required. The four payroll accounts are Payroll-profile-gated —
// nullable, populated only when a company has the Payroll profile enabled; PayrollRunsController
// rejects posting with a clear message when they're null instead of a company that never
// activated payroll silently having no salary/PIT/pension/net-pay accounts to post to.
public class CompanyAccountDefaults
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }

    // 110100 Domestic Customers. (v2 also has 110200 Foreign Customers — this is the default for
    // a document that doesn't specify otherwise; there is no per-partner domestic/foreign
    // selection yet, Partner has no country flag.)
    public Guid ReceivableAccountId { get; set; }

    // 200100 Domestic Suppliers. Same domestic-default caveat as ReceivableAccountId.
    public Guid PayableAccountId { get; set; }

    // 400100 Goods Sales 18% — v2 has no single generic revenue account (it splits by VAT rate/
    // scope instead); this is the most common default. Callers can always override
    // RevenueAccountId per invoice line.
    public Guid RevenueAccountId { get; set; }

    // 661200 Other Expenses — the closest v2 equivalent to the old generic "Operating Expenses"
    // catch-all. Callers can always override ExpenseAccountId per bill line.
    public Guid ExpenseAccountId { get; set; }

    // 240300 Customer Advances.
    public Guid CustomerDepositsAccountId { get; set; }

    // 600100 Salaries. Null unless the Payroll profile is enabled.
    public Guid? SalaryExpenseAccountId { get; set; }

    // 213100 Wage Tax Payable. Null unless the Payroll profile is enabled.
    public Guid? PitPayableAccountId { get; set; }

    // 221100 Pension Contributions - Employee. v2 splits employee (221100) and employer (221200)
    // pension into two liability accounts; PayrollRun.Post() still books both portions as one
    // combined credit line (unchanged in this stage), so this points at the employee-side
    // account only — the employer portion lands here too, which is a known imprecision. Properly
    // splitting the posting into two lines matching v2's two accounts is Stage 4 (posting rules)
    // scope, not this stage's account-resolution fix. Null unless Payroll is enabled.
    public Guid? PensionPayableAccountId { get; set; }

    // 220100 Net Salaries Payable. Null unless the Payroll profile is enabled.
    public Guid? NetPayPayableAccountId { get; set; }

    // 60_Posting_Rules R10 (AUTO, Stage 4): RC18 generates Dr 113300 / Cr 210300 automatically.
    // Both CORE-profile, always present, so required like the first five roles above.
    public Guid ReverseChargeInputVatAccountId { get; set; }
    public Guid ReverseChargeOutputVatAccountId { get; set; }
}
