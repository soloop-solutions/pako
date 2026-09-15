// Chart of accounts (F2) — enum labels and derivation helpers for the "Plani Kontabel v2.0"
// Account fields. `AccountResponse`/`AccountGroupResponse` (from @pako/shared) now carry every
// field for real (see backend/Pako.Domain/Ledger/Account.cs, AccountGroup.cs,
// AccountGroupResolver.cs, AccountTypeDerivation.cs, and CLAUDE.md's "Plani Kontabel v2.0
// migration" sections) — this file only keeps what still has to live client-side: enum label
// maps (the OpenAPI doc doesn't emit enum names, same hand-maintained-enum-order convention as
// every other *-enums.ts file in this repo) and the AccountType/AccountSubType/Statement
// derivation `AccountsController.Create`/`Update` still require the client to compute and send
// (confirmed by reading the controller — it takes `request.AccountType` directly, no server
// derivation for that field). CashFlowCategory is genuinely server-derived now
// (`AccountTypeDerivation.DeriveCashFlowCategory`, from Class/Group) — this file never computes
// it, only labels whatever value the server's response already carries.

import type { IntlShape } from "react-intl";
import type { AccountGroupResponse } from "@pako/shared";

import { AccountType } from "@/lib/ledger-enums";

export const AccountStatement = { BalanceSheet: 0, IncomeStatement: 1 } as const;
export const NormalBalance = { Debit: 0, Credit: 1 } as const;
export const SubledgerType = {
  None: 0,
  Partner: 1,
  Item: 2,
  Asset: 3,
  Employee: 4,
  Bank: 5,
  Cash: 6,
  Tax: 7,
  Customs: 8,
} as const;
export const CitDeductibility = { Full: 0, Limit: 1, Non: 2, Na: 3 } as const;

// backend/Pako.Domain/Ledger/Account.cs's CashFlowCategory enum.
export const CashFlowCategory = { None: 0, Operating: 1, Investing: 2, Financing: 3 } as const;

// [Flags] CompanyProfile, backend/Pako.Domain/Companies/Company.cs.
export const CompanyProfile = {
  None: 0,
  Core: 1,
  Import: 2,
  Mfg: 4,
  Serv: 8,
  Payroll: 16,
  IfrsPlus: 32,
} as const;

const ACCOUNT_STATEMENT_KEYS = ["enum.accountStatement.balanceSheet", "enum.accountStatement.incomeStatement"];
const NORMAL_BALANCE_KEYS = ["enum.normalBalance.debit", "enum.normalBalance.credit"];
const SUBLEDGER_TYPE_KEYS = [
  "enum.subledgerType.none",
  "enum.subledgerType.partner",
  "enum.subledgerType.item",
  "enum.subledgerType.asset",
  "enum.subledgerType.employee",
  "enum.subledgerType.bank",
  "enum.subledgerType.cash",
  "enum.subledgerType.tax",
  "enum.subledgerType.customs",
];
const CIT_DEDUCTIBILITY_KEYS = [
  "enum.citDeductibility.full",
  "enum.citDeductibility.limit",
  "enum.citDeductibility.non",
  "enum.citDeductibility.na",
];
const CASH_FLOW_CATEGORY_KEYS = [
  "enum.cashFlowCategory.none",
  "enum.cashFlowCategory.operating",
  "enum.cashFlowCategory.investing",
  "enum.cashFlowCategory.financing",
];

const PROFILE_KEYS: Array<{ bit: number; labelKey: string }> = [
  { bit: CompanyProfile.Core, labelKey: "enum.companyProfile.core" },
  { bit: CompanyProfile.Import, labelKey: "enum.companyProfile.import" },
  { bit: CompanyProfile.Mfg, labelKey: "enum.companyProfile.mfg" },
  { bit: CompanyProfile.Serv, labelKey: "enum.companyProfile.serv" },
  { bit: CompanyProfile.Payroll, labelKey: "enum.companyProfile.payroll" },
  { bit: CompanyProfile.IfrsPlus, labelKey: "enum.companyProfile.ifrsPlus" },
];

function labelFor(keys: string[], value: number | null | undefined, intl: IntlShape): string {
  if (value == null) return intl.formatMessage({ id: "common.notSet" });
  const key = keys[value];
  return key ? intl.formatMessage({ id: key }) : intl.formatMessage({ id: "enum.unknown" });
}

export function accountStatementLabel(value: number | null | undefined, intl: IntlShape): string {
  return labelFor(ACCOUNT_STATEMENT_KEYS, value, intl);
}

export function normalBalanceLabel(value: number | null | undefined, intl: IntlShape): string {
  return labelFor(NORMAL_BALANCE_KEYS, value, intl);
}

export function subledgerTypeLabel(value: number | null | undefined, intl: IntlShape): string {
  return labelFor(SUBLEDGER_TYPE_KEYS, value, intl);
}

export function citDeductibilityLabel(value: number | null | undefined, intl: IntlShape): string {
  return labelFor(CIT_DEDUCTIBILITY_KEYS, value, intl);
}

export function cashFlowCategoryLabel(value: number | null | undefined, intl: IntlShape): string {
  return labelFor(CASH_FLOW_CATEGORY_KEYS, value, intl);
}

export const SUBLEDGER_TYPE_OPTIONS = SUBLEDGER_TYPE_KEYS.map((labelKey, value) => ({ value, labelKey }));
export const CIT_DEDUCTIBILITY_OPTIONS = CIT_DEDUCTIBILITY_KEYS.map((labelKey, value) => ({ value, labelKey }));
export const NORMAL_BALANCE_OPTIONS = NORMAL_BALANCE_KEYS.map((labelKey, value) => ({ value, labelKey }));

export function companyProfileLabels(profiles: number, intl: IntlShape): string[] {
  return PROFILE_KEYS.filter(({ bit }) => (profiles & bit) === bit).map(({ labelKey }) => intl.formatMessage({ id: labelKey }));
}

export function toggleProfileBit(profiles: number, bit: number): number {
  return (profiles & bit) === bit ? profiles & ~bit : profiles | bit;
}

// B13: mirrors backend/Pako.Domain/Ledger/AccountTypeDerivation.cs's DeriveAccountType exactly —
// one specific AccountType per (Class, Group), the same group boundaries AccountGroupTemplate
// already established, so a newly-created account's derived AccountType matches what the real
// backend computes for the same Code/Class/Group/NormalBalance. `code` carries the one hardcoded
// exception (304100, the single real CurrentYearEarnings account every company gets); `group` is
// the 2-digit group number (accountGroupFromCode's return value), not the full 6-digit code.
export function deriveAccountType(code: string, accountClass: number, group: number | null, normalBalance: number): number {
  if (code === "304100") return AccountType.CurrentYearEarnings;

  if (accountClass === 1) {
    if (group === 10) return AccountType.Cash;
    if (group === 11) return AccountType.Receivable;
    if (group === 12) return AccountType.CurrentAsset;
    if (group === 13) return AccountType.Prepayment;
    if (group === 14) return AccountType.NonCurrentAsset;
    if (group === 15) return AccountType.FixedAsset;
    return AccountType.CurrentAsset;
  }
  if (accountClass === 2) {
    return group === 20 ? AccountType.Payable : AccountType.CurrentLiability;
  }
  if (accountClass === 3) return AccountType.Equity;
  if (accountClass === 4) return group === 42 ? AccountType.OtherIncome : AccountType.Income;
  if (accountClass === 5) return AccountType.CostOfRevenue;
  if (accountClass === 6) return group === 65 ? AccountType.Depreciation : AccountType.Expense;

  // Class 7: Financial & Tax, the one class still disambiguated by NormalBalance alone —
  // financial income (credit-normal) vs. financial/tax expense (debit-normal).
  return normalBalance === NormalBalance.Credit ? AccountType.OtherIncome : AccountType.OtherExpense;
}

export function deriveAccountSubType(subledger: number): number {
  if (subledger === SubledgerType.Bank) return 3; // AccountSubType.Bank
  if (subledger === SubledgerType.Cash) return 4; // AccountSubType.Cash
  return 0; // AccountSubType.None
}

// Mirrors AccountTypeDerivation's IsIncome(t) || IsExpense(t) check exactly — every account type
// that lands on the P&L, not the balance sheet. Not an independent field an accountant chooses.
const INCOME_STATEMENT_TYPES: readonly number[] = [
  AccountType.Income,
  AccountType.OtherIncome,
  AccountType.Expense,
  AccountType.OtherExpense,
  AccountType.Depreciation,
  AccountType.CostOfRevenue,
];

export function deriveStatement(accountType: number): number {
  return INCOME_STATEMENT_TYPES.includes(accountType) ? AccountStatement.IncomeStatement : AccountStatement.BalanceSheet;
}

// Account codes in this chart are always the same 6-digit shape as AccountGroup's own
// CodePrefixStart/CodePrefixEnd (backend/Pako.Domain/Ledger/AccountGroupResolver.cs compares them
// ordinally as plain strings, not numerically — a shorter or longer code would silently fail to
// match any group's range and come back with no groupId at all). Both helpers below read the
// first 1/2 digits of a 6-digit code string, whether that code belongs to an account or to a
// group's own CodePrefixStart.
export function accountClassFromCode(code: string): number | null {
  const digit = code.trim().charAt(0);
  return digit ? Number(digit) : null;
}

export function accountGroupFromCode(code: string): number | null {
  const prefix = code.trim().slice(0, 2);
  return prefix.length === 2 ? Number(prefix) : null;
}

// The real hierarchy (backend/Pako.Localization.Xk/AccountGroupTemplate.cs) is genuinely two
// levels: 7 Class-level groups (ParentGroupId null) each with 1+ Group-level children
// (ParentGroupId set to their class). An account's own GroupId always resolves to the narrowest
// (Group-level) match — see AccountGroupResolver.cs — so this only ever needs to walk up one
// level, not an arbitrary tree depth.
export function leafAccountGroups(groups: AccountGroupResponse[]): AccountGroupResponse[] {
  return groups.filter((g) => g.parentGroupId != null).slice().sort((a, b) => a.codePrefixStart.localeCompare(b.codePrefixStart));
}

export function accountGroupsById(groups: AccountGroupResponse[]): Map<string, AccountGroupResponse> {
  return new Map(groups.map((g) => [g.id, g]));
}

// "Parent name · Group name" for a Group-level group, just "Name" for a Class-level one (or if its
// parent can't be found for some reason) — used both for the grid's group-by column and the
// create-account group picker.
export function accountGroupLabel(
  group: AccountGroupResponse | undefined,
  groupsById: Map<string, AccountGroupResponse>,
  intl: IntlShape,
): string {
  if (!group) return intl.formatMessage({ id: "common.notSet" });
  const parent = group.parentGroupId ? groupsById.get(group.parentGroupId) : undefined;
  return parent ? `${parent.name} · ${group.name}` : group.name;
}
