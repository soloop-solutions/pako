# PAKO — Journal Entry Debit/Credit Validation Improvements

**Date**: 2026-10-16

---

## A. Executive Summary

The previous investigation confirmed that PAKO's existing R30 validation (dual-amount rejection) was correctly implemented at both frontend and backend layers. Three improvements were identified and implemented:

1. **Immediate inline dual-amount warning** — Users now see a visual warning and disabled Save button the moment a line has both Debit and Credit positive, not just after clicking Save.
2. **Negative amount rejection (R31)** — Frontend `sanitizeAmount()` now rejects negative values, and backend `JournalEntry.Post()` enforces a new R31 posting rule rejecting negative Debit/Credit.
3. **Save button reflects line-level errors** — `canSave` now includes `hasDualAmountLines` so Save is disabled while any line has both amounts positive, matching the existing unbalanced-journal pattern.

## B. Previous Findings Verification

| Finding | Status |
|---------|--------|
| Both Debit and Credit fields are independently editable | **Confirmed** — still true |
| Frontend rejects dual-positive at Save time | **Confirmed** — `handleSaveClick` lines 352-358 |
| Backend rejects via R30 `DualAmountLineException` | **Confirmed** — `JournalEntry.Post()` lines 87-93 |
| Auto-balance clears the opposite side | **Confirmed** — `autoBalanceLastLine` produces pure single-sided lines |
| Paste does not bypass validation | **Confirmed** — paste uses same `commitCellValue` path |
| Negative amounts not explicitly rejected | **Confirmed** — was a gap, now fixed |
| Draft API accepts dual-positive lines | **Confirmed** — intentional (see Section D) |
| No database CHECK constraint | **Confirmed** — still no per-line constraint (see Section D) |

## C. Improvement Matrix

| Improvement | Needed? | Implemented? | Verified? |
|---|---|---|---|
| Immediate dual-amount warning | YES | YES | YES — 155 frontend tests pass |
| Negative amount validation | YES | YES | YES — frontend + backend tests pass |
| Draft API consistency | NO (intentional) | N/A | Verified by code inspection |
| Database integrity constraint | NOT NOW | N/A | Deferred (see Section D) |
| Save and Post UX | YES | YES | YES — `canSave` includes `hasDualAmountLines` |
| Spreadsheet paste | ALREADY CORRECT | N/A | Verified — same `commitCellValue` path |
| Auto-balance | ALREADY CORRECT | N/A | Verified — always produces single-sided lines |

## D. Accounting Decisions

### Why dual-positive lines are rejected
Standard double-entry accounting requires each journal line to record movement on exactly one side of an account. A line with both positive Debit and Credit inflates gross debit/credit turnovers, distorts the Trial Balance, and creates ambiguous audit trails — even when its net impact is zero.

### Why negative amounts are rejected
PAKO's entire posting model is built on positive-only amounts with side-flipping. Credit notes, sales returns, purchase returns, and reversals all use `Debit = l.Credit, Credit = l.Debit` (positive swaps), never negation. Every document posting workflow (Invoice, Bill, Payroll, Reconciliation) produces positive-only journal lines. Error messages already enforce positive amounts elsewhere (`SalaryMustBePositive`, `AmountMustBePositive`, `LineQuantityMustBePositive`).

### Why invalid drafts are permitted
PAKO's UI creates a draft and immediately posts it in one operation (`handlePasswordConfirm` calls `apiClient.journalEntries` then `apiClient.post3`). The Create endpoint stores the draft as-is because:
1. R30/R31 are **posting rules**, not creation rules — they fire in `JournalEntry.Post()`, not in `Create()`.
2. The draft exists transiently (milliseconds between Create and Post).
3. Drafts are excluded from the General Ledger — only Posted entries affect balances.
4. A failed Post leaves the draft in the database, but it can never enter the GL without passing all posting rules.
5. Adding creation-time validation would be redundant and could break future draft-editing functionality.

### Why no database CHECK constraint was added
A `CHECK (Debit >= 0 AND Credit >= 0)` constraint would be safe (no existing posted lines violate it), but:
1. It requires a migration, which requires coordination with other agents (one migration per day rule).
2. The domain layer already catches both R30 and R31 before database writes.
3. Draft semantics may evolve — a constraint now could conflict with future partial-draft storage.
4. The improvement is defense-in-depth, not a primary control — deferred to a dedicated migration ticket.

## E. Root Causes

### Dual-amount warning gap
The existing validation only ran at Save time (`handleSaveClick`). The `canSave` flag checked only aggregate balance (`isUnbalanced`), not per-line validity. Users received no feedback until clicking Save.

### Negative amount gap
`sanitizeAmount()` only checked `Number.isFinite()` — negative values are finite, so they passed through. The backend had no explicit R31 rule; R30 (`Debit > 0 && Credit > 0`) doesn't catch a line like `Debit = -100, Credit = 0`.

## F. Implementation Details

### Frontend Changes

| File | Change |
|------|--------|
| `apps/web/src/pages/ledger/JournalEntryGrid.tsx` | Added `dualAmountRows` memo detecting lines with both positive amounts; added `hasDualAmountLines` to `canSave`; added `border-destructive` + tooltip on affected debit/credit cells; added inline warning text below action buttons |
| `apps/web/src/pages/ledger/journal-grid/lineFields.ts` | `sanitizeAmount()` now rejects negative values (returns previous value) |
| `apps/web/src/pages/ledger/journal-grid/lineFields.test.ts` | Added tests: negative rejection, zero acceptance |
| `apps/web/src/pages/ledger/JournalEntryGrid.test.tsx` | Added 3 tests: inline warning appears, warning disappears on correction, negative values rejected |
| `apps/web/src/i18n/messages.ts` | Added `journalGrid.dualAmountWarning` and `journalGrid.lineNegativeAmount` (EN + SQ) |

### Backend Changes

| File | Change |
|------|--------|
| `backend/Pako.Domain/Ledger/JournalEntry.cs` | Added R31 check in `Post()`: rejects lines with `Debit < 0` or `Credit < 0` via `NegativeAmountLineException` |
| `backend/Pako.Domain/Ledger/Exceptions.cs` | Added `NegativeAmountLineException` class |
| `backend/Pako.Api/Controllers/JournalEntriesController.cs` | Catch `NegativeAmountLineException` in `Post()` and `Reverse()` |
| `backend/Pako.Tests/JournalEntryPostingTests.cs` | Added `Post_RefusesLineWithNegativeDebit_R31` and `Post_RefusesLineWithNegativeCredit_R31` tests |

## G. Automated Test Results

### Frontend
```
Test Files  26 passed (26)
     Tests  155 passed (155)
```
- TypeScript: Zero errors
- ESLint: Zero warnings

### Backend
```
JournalEntryPostingTests: Passed 12, Failed 0
```
Including new R31 tests:
- `Post_RefusesLineWithNegativeDebit_R31` — PASS
- `Post_RefusesLineWithNegativeCredit_R31` — PASS

## H. Manual Verification

1. Navigate to Ledger → New Journal Entry
2. Select an account on line 1
3. Type Debit = 1000, then Tab to Credit and type 500
4. **Expected**: Both debit/credit cells show red border; inline warning appears below buttons; Save button is disabled
5. Clear Credit (empty the field), Tab away
6. **Expected**: Red borders disappear; warning disappears; Save re-enables (if balanced)
7. Type a negative value in Debit (e.g., "-200")
8. **Expected**: The value is rejected — the cell reverts to its previous value
9. Complete a valid balanced entry (e.g., 100100 Debit 1000 / 400100 Credit 1000)
10. Click Save and Post → should succeed normally

## I. Remaining Risks

1. **Database constraint**: No CHECK constraint exists to prevent negative values at the database level. The domain layer catches it, but a direct SQL INSERT could bypass it. A migration should be added when convenient.
2. **Negative amounts via Create API**: The Create endpoint does not reject negative amounts — they can exist in Draft state. This is acceptable because only Posted entries affect the GL, and R31 prevents posting.
3. **Existing data**: If any Draft entries in the database already have negative amounts, they cannot be posted. No data migration is needed because they never reached the GL.

## J. Final Status

### **IMPROVEMENTS IMPLEMENTED AND VERIFIED**

| Component | Status |
|-----------|--------|
| R30 dual-amount validation (existing) | **ALREADY CORRECT — PRESERVED** |
| Inline dual-amount warning (new) | **IMPLEMENTED AND TESTED** |
| Negative amount rejection — frontend (new) | **IMPLEMENTED AND TESTED** |
| Negative amount rejection — backend R31 (new) | **IMPLEMENTED AND TESTED** |
| Save button reflects line-level errors (new) | **IMPLEMENTED AND TESTED** |
| Auto-balance correctness | **ALREADY CORRECT — VERIFIED** |
| Spreadsheet paste validation | **ALREADY CORRECT — VERIFIED** |
| Draft API permissiveness | **INTENTIONAL — DOCUMENTED** |
| Database CHECK constraint | **DEFERRED — NOT NEEDED NOW** |
