// F2 (chart of accounts) — types and enum labels for the "Plani Kontabel v2.0" Account fields
// that are not yet on the real generated AccountResponse (see backend/Pako.Domain/Ledger/Account.cs
// and CLAUDE.md's "Plani Kontabel v2.0 migration — Stage 1: schema" section). Field names/order
// below are copied verbatim from that entity, not guessed — keep them in sync by hand the same way
// ledger-enums.ts already does for AccountType/AccountSubType, until the backend contract for these
// fields is real and packages/shared is regenerated. See src/mocks/handlers.ts for the mock that
// currently serves this shape.

import type { IntlShape } from "react-intl";
import type { AccountResponse } from "@pako/shared";

export interface AccountV2 extends Omit<AccountResponse, "parentAccountId"> {
  parentAccountId: string | null;
  nameSq: string | null;
  class: number | null;
  group: number | null;
  statement: number | null;
  normalBalance: number | null;
  subledger: number | null;
  isControl: boolean;
  isPostable: boolean;
  defaultVatCode: string | null;
  citDeductibility: number | null;
  citLimitRule: string | null;
  profiles: number;
  isActive: boolean;
  createdAt: string;
}

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

export const SUBLEDGER_TYPE_OPTIONS = SUBLEDGER_TYPE_KEYS.map((labelKey, value) => ({ value, labelKey }));
export const CIT_DEDUCTIBILITY_OPTIONS = CIT_DEDUCTIBILITY_KEYS.map((labelKey, value) => ({ value, labelKey }));
export const NORMAL_BALANCE_OPTIONS = NORMAL_BALANCE_KEYS.map((labelKey, value) => ({ value, labelKey }));

export function companyProfileLabels(profiles: number, intl: IntlShape): string[] {
  return PROFILE_KEYS.filter(({ bit }) => (profiles & bit) === bit).map(({ labelKey }) => intl.formatMessage({ id: labelKey }));
}

export function toggleProfileBit(profiles: number, bit: number): number {
  return (profiles & bit) === bit ? profiles & ~bit : profiles | bit;
}

// Class 1/2/3/4/5/6 map directly; Class 7 is the one genuine split, by NormalBalance alone
// (Credit -> Income, Debit -> Expense) — mirrors backend/Pako.Domain/Ledger/AccountTypeDerivation.cs
// exactly (see CLAUDE.md's Stage 2 section), so a newly-created account's derived AccountType/
// Statement match what the real backend will compute once it seeds this data for real.
export function deriveAccountType(accountClass: number, normalBalance: number): number {
  if (accountClass === 1) return 0; // Asset
  if (accountClass === 2) return 1; // Liability
  if (accountClass === 3) return 2; // Equity
  if (accountClass === 4) return 3; // Income
  if (accountClass === 5 || accountClass === 6) return 4; // Expense
  return normalBalance === NormalBalance.Credit ? 3 : 4; // Class 7
}

export function deriveAccountSubType(subledger: number): number {
  if (subledger === SubledgerType.Bank) return 3; // AccountSubType.Bank
  if (subledger === SubledgerType.Cash) return 4; // AccountSubType.Cash
  return 0; // AccountSubType.None
}

// Statement follows AccountType 1:1 in this chart (BS for Asset/Liability/Equity, IS for
// Income/Expense) — not an independent field an accountant chooses, same reasoning as AccountType.
export function deriveStatement(accountType: number): number {
  return accountType === 3 || accountType === 4 ? AccountStatement.IncomeStatement : AccountStatement.BalanceSheet;
}

export function accountClassFromCode(code: string): number | null {
  const digit = code.trim().charAt(0);
  return digit ? Number(digit) : null;
}

export function accountGroupFromCode(code: string): number | null {
  const prefix = code.trim().slice(0, 2);
  return prefix.length === 2 ? Number(prefix) : null;
}

export function groupLabel(accountClass: number | null, group: number | null, intl: IntlShape): string {
  if (accountClass == null || group == null) return intl.formatMessage({ id: "common.notSet" });
  const groupCode = String(group).padStart(2, "0");
  const typeLabel = accountTypeLabelForClass(accountClass, intl);
  return `${groupCode} · ${typeLabel}`;
}

// Only used to label a group header row — Class 7 has no single AccountType (it splits per
// account by NormalBalance, see deriveAccountType above), so its group label says "Income /
// Expense" rather than picking one arbitrarily.
function accountTypeLabelForClass(accountClass: number, intl: IntlShape): string {
  const keys = [
    "enum.accountType.asset",
    "enum.accountType.liability",
    "enum.accountType.equity",
    "enum.accountType.income",
    "enum.accountType.expense",
  ];
  // Class -> AccountType index: 1=Asset,2=Liability,3=Equity,4=Income,5&6=Expense.
  const classToTypeIndex: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 4 };
  const typeIndex = classToTypeIndex[accountClass];
  if (typeIndex != null) {
    return intl.formatMessage({ id: keys[typeIndex] });
  }
  return `${intl.formatMessage({ id: keys[3] })} / ${intl.formatMessage({ id: keys[4] })}`;
}
