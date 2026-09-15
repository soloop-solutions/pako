namespace Pako.Domain.Ledger;

// Derives the legacy AccountType/AccountSubType (used by ReportsController's P&L/balance-sheet
// netting and the Cash/Bank record-payment check) from Plani Kontabel v2.0's Class/NormalBalance/
// Subledger fields, so nothing downstream had to change when the v2 chart was seeded
// (COA_V2_IMPLEMENTATION_BRIEF.md Stage 1 designed this; Stage 2 is its first caller).
public static class AccountTypeDerivation
{
    // B13: one specific AccountType per (Class, Group), reusing the group boundaries B2 already
    // established (AccountGroupTemplate) rather than inventing a second classification scheme.
    // - 304100 is the one hardcoded exception: Class 3 like every other equity account, but it's
    //   the real, single CurrentYearEarnings account every company gets (see PostingRuleValidator
    //   R05 — nothing ever posts to it directly) that ReportsController.BalanceSheet now anchors
    //   its computed net-income line to, instead of a synthetic Guid.Empty row.
    // - Class 1: cash/receivables/inventory/prepayments/investments/fixed assets split by Group.
    // - Class 2: payables split out from the general current-liability groups (VAT, payroll,
    //   loans, accrued expenses).
    // - Class 4: Group 42 (Other Operating Income) is OtherIncome; Groups 40/41 (Sales/Service
    //   Revenue) are the operating Income.
    // - Class 5 (Cost of Sales) is CostOfRevenue in its entirety.
    // - Class 6: Group 65 (Depreciation & Amortization) is Depreciation; every other opex group
    //   is the operating Expense.
    // - Class 7 (Financial & Tax) is the one class still disambiguated by NormalBalance alone —
    //   financial income (700xxx, credit-normal) vs. financial/tax expense (710xxx-720xxx,
    //   debit-normal) — both OtherIncome/OtherExpense, not the operating Income/Expense.
    public static AccountType DeriveAccountType(string code, int accountClass, int? group, NormalBalance normalBalance)
    {
        if (code == "304100")
        {
            return AccountType.CurrentYearEarnings;
        }

        return (accountClass, group) switch
        {
            (1, 10) => AccountType.Cash,
            (1, 11) => AccountType.Receivable,
            (1, 12) => AccountType.CurrentAsset,
            (1, 13) => AccountType.Prepayment,
            (1, 14) => AccountType.NonCurrentAsset,
            (1, 15) => AccountType.FixedAsset,
            (1, _) => AccountType.CurrentAsset,

            (2, 20) => AccountType.Payable,
            (2, _) => AccountType.CurrentLiability,

            (3, _) => AccountType.Equity,

            (4, 42) => AccountType.OtherIncome,
            (4, _) => AccountType.Income,

            (5, _) => AccountType.CostOfRevenue,

            (6, 65) => AccountType.Depreciation,
            (6, _) => AccountType.Expense,

            (7, _) => normalBalance == NormalBalance.Credit ? AccountType.OtherIncome : AccountType.OtherExpense,

            _ => throw new ArgumentOutOfRangeException(nameof(accountClass), accountClass, "Class must be 1-7.")
        };
    }

    // Report-bucket rollups: ReportsController groups by these rather than by exact AccountType,
    // so the P&L/balance-sheet shape doesn't change just because a type got more specific.
    public static bool IsAsset(AccountType t) => t is
        AccountType.Receivable or AccountType.Cash or AccountType.CurrentAsset or
        AccountType.NonCurrentAsset or AccountType.Prepayment or AccountType.FixedAsset;

    public static bool IsLiability(AccountType t) => t is
        AccountType.Payable or AccountType.CreditCard or AccountType.CurrentLiability or AccountType.NonCurrentLiability;

    public static bool IsEquity(AccountType t) => t is AccountType.Equity or AccountType.CurrentYearEarnings;

    public static bool IsIncome(AccountType t) => t is AccountType.Income or AccountType.OtherIncome;

    public static bool IsExpense(AccountType t) => t is
        AccountType.Expense or AccountType.OtherExpense or AccountType.Depreciation or AccountType.CostOfRevenue;

    // B13: Odoo's include_initial_balance — whether the account's balance carries forward from
    // the previous period (every Balance Sheet type, plus off-balance memo accounts) or resets to
    // zero at the start of each fiscal year (every Income Statement type, and CurrentYearEarnings
    // itself, which is recomputed fresh each year rather than carried — Retained Earnings is what
    // accumulates prior years, and this chart doesn't have that account yet).
    public static bool IncludesInitialBalance(AccountType t) =>
        !IsIncome(t) && !IsExpense(t) && t != AccountType.CurrentYearEarnings;

    // Only Bank/Cash are derived: that's the only subtype any live code actually consumes
    // (InvoicesController/BillsController's record-payment Cash-or-Bank check). Receivable/
    // Payable is deliberately left None here — v2 has two control accounts per side (domestic/
    // foreign), so "the" Receivable/Payable subtype no longer identifies a single account, and
    // AR/AP resolution now goes through CompanyAccountDefaults instead.
    public static AccountSubType DeriveAccountSubType(SubledgerType subledger) => subledger switch
    {
        SubledgerType.Bank => AccountSubType.Bank,
        SubledgerType.Cash => AccountSubType.Cash,
        _ => AccountSubType.None
    };

    // B3: standard indirect-method cash-flow-statement categorization, from the same v2 Class/
    // Group the account is already seeded with — nothing new to source.
    // - Group 10 (Cash and Cash Equivalents) is the balance a cash-flow statement reconciles TO,
    //   not a flow itself, so it's None rather than Operating.
    // - Group 14 (Investments) and 15 (Fixed Assets) are Investing.
    // - Group 23 (Short-term Loans) and the whole of Class 3 (Share Capital & Reserves) are
    //   Financing.
    // - Everything else — receivables, payables, VAT, payroll liabilities, accrued expenses,
    //   revenue, cost of sales, opex, financial income/expense, tax — is Operating.
    public static CashFlowCategory DeriveCashFlowCategory(int accountClass, int? group) => (accountClass, group) switch
    {
        (_, 10) => CashFlowCategory.None,
        (_, 14 or 15) => CashFlowCategory.Investing,
        (3, _) or (_, 23) => CashFlowCategory.Financing,
        _ => CashFlowCategory.Operating
    };
}
