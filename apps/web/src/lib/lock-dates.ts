// F3 (lock dates in settings) — labels/explanations for the five lock dates, plus the
// LockDateField enum mapping the real backend uses.
//
// The real backend (backend/Pako.Api/Controllers/CompanyLocksController.cs, route
// api/companies/{companyId}/locks) is fully built: PUT soft (one field at a time, via
// LockDateField), PUT hard (one-way, cannot move backwards, blocked by draft entries on/before the
// date), GET/POST exceptions, POST exceptions/{id}/revoke. All five lock dates themselves
// (accountingLockDate/taxLockDate/saleLockDate/purchaseLockDate/hardLockDate) live on the plain
// `CompanyResponse` already returned by `GET /api/companies` — there is no separate GET for them.
// LockDatesSettings.tsx reads them off `useCompany()`'s `companies` list and calls
// `apiClient.soft`/`apiClient.hard`/`apiClient.exceptionsAll`/`apiClient.exceptions`/
// `apiClient.revoke` directly (all real, generated methods) rather than any mock.

import type { IntlShape } from "react-intl";

export type LockDateKey = "accountingLockDate" | "taxLockDate" | "saleLockDate" | "purchaseLockDate" | "hardLockDate";

export const SOFT_LOCK_DATE_KEYS = ["accountingLockDate", "taxLockDate", "saleLockDate", "purchaseLockDate"] as const satisfies readonly LockDateKey[];

export type SoftLockDateKey = (typeof SOFT_LOCK_DATE_KEYS)[number];

export const HARD_LOCK_DATE_KEY: LockDateKey = "hardLockDate";

// Mirrors backend/Pako.Domain/Companies/AccountLockException.cs's `LockDateField` enum — its
// numeric order (0..3) is the wire format both `SetSoftLockRequest.lockDateField` and
// `GrantLockExceptionRequest.lockDateField` use, and NSwag did not emit a TS enum for it (the
// generated client types the field as a plain `number`), so this mapping is hand-kept in sync with
// that C# enum's declaration order.
export const LOCK_DATE_FIELD_VALUES: Record<SoftLockDateKey, number> = {
  accountingLockDate: 0,
  taxLockDate: 1,
  saleLockDate: 2,
  purchaseLockDate: 3,
};

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
