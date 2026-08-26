// Pako.Api's built-in Microsoft.AspNetCore.OpenApi doesn't emit enum member names, so the
// generated client types these as plain `number`. Order must be kept in sync by hand with
// backend/Pako.Domain/Ledger/{Account,Journal}.cs — see packages/shared/README.md.

const ACCOUNT_TYPE_LABELS = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;
const ACCOUNT_SUB_TYPE_LABELS = ["None", "Receivable", "Payable", "Bank", "Cash"] as const;

export function accountTypeLabel(value: number): string {
  return ACCOUNT_TYPE_LABELS[value] ?? `Unknown (${value})`;
}

export function accountSubTypeLabel(value: number): string {
  return ACCOUNT_SUB_TYPE_LABELS[value] ?? `Unknown (${value})`;
}

const ACCOUNT_SUB_TYPE_BANK = 3;
const ACCOUNT_SUB_TYPE_CASH = 4;

export function isCashOrBankAccountSubType(value: number): boolean {
  return value === ACCOUNT_SUB_TYPE_BANK || value === ACCOUNT_SUB_TYPE_CASH;
}
