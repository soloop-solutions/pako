using Pako.Domain.Companies;

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

// Plani Kontabel v2.0 (10_COA_Master). BS/IS per that sheet's "Stmt" column literal values —
// not "PL" as an earlier draft of the implementation brief mistakenly called it.
public enum AccountStatement
{
    BalanceSheet,
    IncomeStatement
}

public enum NormalBalance
{
    Debit,
    Credit
}

// 10_COA_Master "Subledger" column: the analytical dimension a posting to this account must
// carry. '-' in the sheet maps to None.
public enum SubledgerType
{
    None,
    Partner,
    Item,
    Asset,
    Employee,
    Bank,
    Cash,
    Tax,
    Customs
}

// 10_COA_Master "CIT" column: corporate income tax deductibility. Na = not applicable
// (balance-sheet/payroll accounts), distinct from Non (a real expense that's a CIT add-back).
public enum CitDeductibility
{
    Full,
    Limit,
    Non,
    Na
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

    // Plani Kontabel v2.0 fields (COA_V2_IMPLEMENTATION_BRIEF.md Stage 1). Nullable: the
    // legacy Stage-0 chart (DefaultChartOfAccountsTemplate) predates v2 and has no data for
    // these columns — only Stage 2's 233-row seed populates them for real. AccountType/
    // AccountSubType above are kept and NOT derived from these yet, so no existing behavior
    // (ReportsController's P&L/balance-sheet netting, the Cash/Bank record-payment check)
    // changes in this stage.
    public string? NameSq { get; set; }
    public int? Class { get; set; }
    public int? Group { get; set; }
    public AccountStatement? Statement { get; set; }
    public NormalBalance? NormalBalance { get; set; }
    public SubledgerType? Subledger { get; set; }

    // R04: control accounts (110100, 110200, 200100, 200200) accept only subledger-document
    // postings, never a manual journal entry. Not enforced until Stage 4.
    public bool IsControl { get; set; }

    // R02: group/header rows may not receive postings. Every row in the v2 seed is a postable
    // leaf account, so this defaults true; the flag exists for a future header row.
    public bool IsPostable { get; set; } = true;

    // 20_VAT_Codes short code (S18, B08, RC18, NA, ...). Deliberately a plain string, not a DB
    // foreign key: there is no VAT-code table with real rows to reference until Stage 3 seeds
    // 20_VAT_Codes, and Account itself has no v2 data until Stage 2.
    public string? DefaultVatCode { get; set; }
    public CitDeductibility? CitDeductibility { get; set; }

    // Populated only where CitDeductibility == Limit (e.g. "Deductible up to 15% of gross
    // salary") — the 10_COA_Master "Note" column text for that row.
    public string? CitLimitRule { get; set; }

    // Which activation profile(s) this account belongs to. Unlike the fields above this is
    // non-nullable: CompanyProfile.None (0) is itself a meaningful "no profile assigned yet"
    // value for a flags enum, not a sentinel standing in for missing data.
    public CompanyProfile Profiles { get; set; } = CompanyProfile.None;

    // R26: accounts with posted movement are deactivated, never deleted.
    public bool IsActive { get; set; } = true;

    // R25: account codes are immutable; renumbering happens via a versioned mapping (90_Migration),
    // never by editing Code in place. ValidFrom/ValidTo record the date range a code was in effect.
    public DateOnly? ValidFrom { get; set; }
    public DateOnly? ValidTo { get; set; }
}
