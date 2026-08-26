// Pako.Api's built-in Microsoft.AspNetCore.OpenApi doesn't emit enum member names, so the
// generated client types these as plain `number`. Order must be kept in sync by hand with
// backend/Pako.Domain/Ledger/{Account,Journal}.cs - mirrors apps/web/src/lib/ledger-enums.ts.

const ACCOUNT_SUB_TYPE_BANK = 3;
const ACCOUNT_SUB_TYPE_CASH = 4;

export function isCashOrBankAccountSubType(value: number): boolean {
  return value === ACCOUNT_SUB_TYPE_BANK || value === ACCOUNT_SUB_TYPE_CASH;
}
