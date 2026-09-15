// F3 (lock dates in settings) — types for the lock-date settings + exception-list contract.
//
// Two of the five lock dates are real fields on the backend's `Company` entity today
// (backend/Pako.Domain/Companies/Company.cs: `AccountingLockDate`, `TaxLockDate` — already on the
// generated `CompanyResponse`, see packages/shared/src/generated/api-client.ts) and are already
// enforced server-side by `JournalEntry.Post()` (backend/Pako.Domain/Ledger/Exceptions.cs:
// `AccountingLockDateViolationException`/`TaxLockDateViolationException`). There is no write
// endpoint for them, and no `SaleLockDate`/`PurchaseLockDate`/`HardLockDate` field and no
// exception model at all — see src/mocks/lockDatesHandlers.ts for what this mocks and why.

import type { IntlShape } from "react-intl";

export interface LockDateSettings {
  accountingLockDate: string | null;
  taxLockDate: string | null;
  saleLockDate: string | null;
  purchaseLockDate: string | null;
  hardLockDate: string | null;
}

export type LockDateKey = keyof LockDateSettings;

export const SOFT_LOCK_DATE_KEYS = ["accountingLockDate", "taxLockDate", "saleLockDate", "purchaseLockDate"] as const satisfies readonly LockDateKey[];

export const HARD_LOCK_DATE_KEY: LockDateKey = "hardLockDate";

const LOCK_DATE_LABEL_KEYS: Record<LockDateKey, string> = {
  accountingLockDate: "lockDates.global.label",
  taxLockDate: "lockDates.tax.label",
  saleLockDate: "lockDates.sale.label",
  purchaseLockDate: "lockDates.purchase.label",
  hardLockDate: "lockDates.hard.label",
};

const LOCK_DATE_EXPLANATION_KEYS: Record<LockDateKey, string> = {
  accountingLockDate: "lockDates.global.explanation",
  taxLockDate: "lockDates.tax.explanation",
  saleLockDate: "lockDates.sale.explanation",
  purchaseLockDate: "lockDates.purchase.explanation",
  hardLockDate: "lockDates.hard.explanation",
};

export function lockDateLabel(key: LockDateKey, intl: IntlShape): string {
  return intl.formatMessage({ id: LOCK_DATE_LABEL_KEYS[key] });
}

export function lockDateExplanation(key: LockDateKey, intl: IntlShape): string {
  return intl.formatMessage({ id: LOCK_DATE_EXPLANATION_KEYS[key] });
}

export interface LockException {
  id: string;
  memberUserId: string;
  memberEmail: string;
  reason: string;
  until: string;
  grantedByEmail: string;
  grantedAt: string;
}

export interface GrantLockExceptionRequest {
  memberUserId: string;
  memberEmail: string;
  reason: string;
  until: string;
  grantedByEmail: string;
}
