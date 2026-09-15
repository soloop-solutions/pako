// Pako.Api's built-in Microsoft.AspNetCore.OpenApi doesn't emit enum member names, so the
// generated client types these as plain `number`. Order must be kept in sync by hand with
// backend/Pako.Domain/Ledger/{Account,Journal}.cs — see packages/shared/README.md.

import type { IntlShape } from "react-intl";

const ACCOUNT_TYPE_KEYS = [
  "enum.accountType.asset",
  "enum.accountType.liability",
  "enum.accountType.equity",
  "enum.accountType.income",
  "enum.accountType.expense",
] as const;

// F5 — order matches ACCOUNT_TYPE_KEYS above (and backend/Pako.Domain/Ledger/Account.cs's
// AccountType enum) by hand. Used to filter the plain account picker (apiClient.accounts) down to
// Income/Expense accounts for an item's default revenue/expense account fields and for the
// invoice/bill line account override.
export const AccountType = { Asset: 0, Liability: 1, Equity: 2, Income: 3, Expense: 4 } as const;

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
