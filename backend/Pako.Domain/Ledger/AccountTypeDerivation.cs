namespace Pako.Domain.Ledger;

// Derives the legacy AccountType/AccountSubType (used by ReportsController's P&L/balance-sheet
// netting and the Cash/Bank record-payment check) from Plani Kontabel v2.0's Class/NormalBalance/
// Subledger fields, so nothing downstream had to change when the v2 chart was seeded
// (COA_V2_IMPLEMENTATION_BRIEF.md Stage 1 designed this; Stage 2 is its first caller).
public static class AccountTypeDerivation
{
    // Class 1/2/3 -> Asset/Liability/Equity regardless of NormalBalance: contra accounts (e.g.
    // accumulated depreciation, credit-normal within an asset class) still net correctly, since
    // ReportsController nets each AccountType bucket by that bucket's own assumed normal-balance
    // sign, not by inspecting each account's actual balance. Class 4 -> Income for the same
    // reason (covers the one debit-normal contra-revenue row, 400900). Class 5/6 -> Expense
    // (every row in those classes is debit-normal). Class 7 is the one genuine split: it holds
    // both financial income (700xxx, credit-normal) and financial expense (710xxx-720xxx,
    // debit-normal), disambiguated by NormalBalance alone.
    public static AccountType DeriveAccountType(int accountClass, NormalBalance normalBalance) => accountClass switch
    {
        1 => AccountType.Asset,
        2 => AccountType.Liability,
        3 => AccountType.Equity,
        4 => AccountType.Income,
        5 or 6 => AccountType.Expense,
        7 => normalBalance == NormalBalance.Credit ? AccountType.Income : AccountType.Expense,
        _ => throw new ArgumentOutOfRangeException(nameof(accountClass), accountClass, "Class must be 1-7.")
    };

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
