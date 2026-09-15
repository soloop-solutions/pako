// Pako.Api's built-in Microsoft.AspNetCore.OpenApi doesn't emit enum member names, so the
// generated client types these as plain `number`. Order must be kept in sync by hand with
// backend/Pako.Domain/Ledger/{Account,Journal}.cs — see packages/shared/README.md.

import type { IntlShape } from "react-intl";

// B13: widened from the old 5-bucket {Asset,Liability,Equity,Income,Expense} to Odoo's real
// 19-value AccountType (backend/Pako.Domain/Ledger/Account.cs). The old bucket keys
// (enum.accountType.asset/liability/equity/income/expense) stay in messages.ts, unused, per this
// repo's "never rename or delete a key" convention — they described a classification that no
// longer exists on the wire. `income`/`expense`/`equity` are reused below since those three exact
// names still mean the same single AccountType value in the new scheme.
const ACCOUNT_TYPE_KEYS = [
  "enum.accountType.receivable",
  "enum.accountType.cash",
  "enum.accountType.currentAsset",
  "enum.accountType.nonCurrentAsset",
  "enum.accountType.prepayment",
  "enum.accountType.fixedAsset",
  "enum.accountType.payable",
  "enum.accountType.creditCard",
  "enum.accountType.currentLiability",
  "enum.accountType.nonCurrentLiability",
  "enum.accountType.equity",
  "enum.accountType.currentYearEarnings",
  "enum.accountType.income",
  "enum.accountType.otherIncome",
  "enum.accountType.expense",
  "enum.accountType.otherExpense",
  "enum.accountType.depreciation",
  "enum.accountType.costOfRevenue",
  "enum.accountType.offBalance",
] as const;

// Order matches ACCOUNT_TYPE_KEYS above and backend/Pako.Domain/Ledger/Account.cs's AccountType
// enum exactly, by hand.
export const AccountType = {
  Receivable: 0,
  Cash: 1,
  CurrentAsset: 2,
  NonCurrentAsset: 3,
  Prepayment: 4,
  FixedAsset: 5,
  Payable: 6,
  CreditCard: 7,
  CurrentLiability: 8,
  NonCurrentLiability: 9,
  Equity: 10,
  CurrentYearEarnings: 11,
  Income: 12,
  OtherIncome: 13,
  Expense: 14,
  OtherExpense: 15,
  Depreciation: 16,
  CostOfRevenue: 17,
  OffBalance: 18,
} as const;

// Report-bucket groupings mirroring AccountTypeDerivation.IsIncome/IsExpense exactly — used to
// filter the plain account picker (apiClient.accountsAll) down to revenue/expense accounts for an
// item's default revenue/expense account fields and for the invoice/bill line account override.
export const INCOME_ACCOUNT_TYPES: readonly number[] = [AccountType.Income, AccountType.OtherIncome];
export const EXPENSE_ACCOUNT_TYPES: readonly number[] = [
  AccountType.Expense,
  AccountType.OtherExpense,
  AccountType.Depreciation,
  AccountType.CostOfRevenue,
];

export function isIncomeAccountType(value: number): boolean {
  return INCOME_ACCOUNT_TYPES.includes(value);
}

export function isExpenseAccountType(value: number): boolean {
  return EXPENSE_ACCOUNT_TYPES.includes(value);
}

const ACCOUNT_SUB_TYPE_KEYS = [
  "enum.accountSubType.none",
  "enum.accountSubType.receivable",
  "enum.accountSubType.payable",
  "enum.accountSubType.bank",
  "enum.accountSubType.cash",
] as const;

export function accountTypeLabel(value: number, intl: IntlShape): string {
  const key = ACCOUNT_TYPE_KEYS[value];
  return key ? intl.formatMessage({ id: key }) : `Unknown (${value})`;
}

export function accountSubTypeLabel(value: number, intl: IntlShape): string {
  const key = ACCOUNT_SUB_TYPE_KEYS[value];
  return key ? intl.formatMessage({ id: key }) : `Unknown (${value})`;
}

const ACCOUNT_SUB_TYPE_BANK = 3;
const ACCOUNT_SUB_TYPE_CASH = 4;

export function isCashOrBankAccountSubType(value: number): boolean {
  return value === ACCOUNT_SUB_TYPE_BANK || value === ACCOUNT_SUB_TYPE_CASH;
}
