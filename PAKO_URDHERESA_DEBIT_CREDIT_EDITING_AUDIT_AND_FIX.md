# PAKO Urdheresa: Debit & Credit Editing Audit and Fix

## 1. Was the Feature Already Implemented?

**Yes, the core requirement was already implemented.** Both Debit and Credit fields are independently editable. Users can:

- Enter, edit, and clear Debit amounts freely
- Enter, edit, and clear Credit amounts freely
- Add multiple journal lines
- Split amounts across multiple accounts
- See totals and difference recalculate immediately
- Use Auto-balance to close the gap
- Navigate entirely by keyboard (Enter, Tab, Shift+Tab, Escape, arrows)
- Paste multi-cell blocks from spreadsheets
- Save and post balanced entries

There is **no mutual exclusion** between Debit and Credit fields. Editing one does **not** clear or overwrite the other.

## 2. Existing Behavior (Before Fix)

- Both fields editable at all times during entry
- Totals computed via cent-integer arithmetic (no float drift)
- Auto-balance overwrites the last line's short side
- Two-step save: create Draft, then Post
- Posted entries are immutable (reversals only)
- Balance enforced at Post time (domain + Postgres trigger)
- Posting rules R02/R04/R05 enforced at Create time

## 3. Bugs and Missing Functionality Found

### Bug: Auto-balance could create dual-positive lines

`autoBalanceLastLine()` added to the short side without clearing the opposite. If the last line already had a value on both sides, the result was a line with both Debit > 0 and Credit > 0.

**Example:** Lines = [{debit: 200}, {debit: 50, credit: 10}]. Auto-balance would set line 2 to {debit: 50, credit: 210} — both positive.

### Missing: No validation for dual-positive lines

Neither the frontend, backend, nor database prevented a posted journal line from having both Debit > 0 and Credit > 0 simultaneously. Standard double-entry requires each line to post to one side only.

## 4. Root Causes

1. `autoBalanceLastLine()` computed the diff across all lines and adjusted the last line's short side additively, without considering the last line's existing opposite-side value.
2. No validation rule existed for the single-sided constraint. The balance check (total debit = total credit) is necessary but not sufficient.

## 5. Implementation Plan

1. Rewrite `autoBalanceLastLine()` to compute totals excluding the last line, then set the last line as a pure single-sided balancing entry.
2. Add frontend save-time validation rejecting lines with both Debit > 0 and Credit > 0.
3. Add backend posting rule R30 in `JournalEntry.Post()` rejecting dual-positive lines.
4. Add `DualAmountLineException` to the domain.
5. Catch the new exception in `JournalEntriesController.Post()` and `Reverse()`.
6. Add i18n strings (EN + SQ).
7. Add tests for all changes.

## 6. Changes Made

### Frontend

| File | Change |
|------|--------|
| `apps/web/src/pages/ledger/journal-grid/balance.ts` | Rewrote `autoBalanceLastLine()` to compute totals excluding the last line and set only the needed side, clearing the opposite. |
| `apps/web/src/pages/ledger/journal-grid/balance.test.ts` | Updated test expectations for the new behavior; added "never creates dual-positive line" test case. |
| `apps/web/src/pages/ledger/JournalEntryGrid.tsx` | Added save-time validation: lines with both Debit > 0 and Credit > 0 are rejected with a clear error message. |
| `apps/web/src/i18n/messages.ts` | Added `journalGrid.lineBothDebitAndCredit` key in EN and SQ. |

### Backend

| File | Change |
|------|--------|
| `backend/Pako.Domain/Ledger/Exceptions.cs` | Added `DualAmountLineException` (R30). |
| `backend/Pako.Domain/Ledger/JournalEntry.cs` | Added R30 validation in `Post()`: rejects lines with both Debit > 0 and Credit > 0. |
| `backend/Pako.Api/Controllers/JournalEntriesController.cs` | Catch `DualAmountLineException` in `Post()` and `Reverse()` actions. |
| `backend/Pako.Tests/JournalEntryPostingTests.cs` | Added `Post_RefusesLineWithBothDebitAndCredit_R30` and `Post_AllowsLineWithZeroOnOneSide_R30` tests. |

## 7. Test Results

- **Frontend**: 146/146 tests pass (including all balance and JournalEntryGrid tests)
- **Backend**: 405/418 tests pass. 13 failures are pre-existing in `ItemsControllerTests` / `InvoicesControllerTests` (unrelated to journal entries).
- **TypeScript**: Clean
- **ESLint**: Clean

## 8. Accounting Validation Decisions

- **Both fields remain editable during entry** — users can type into Debit and Credit freely.
- **Posting enforces single-sided lines** — a line with both Debit > 0 and Credit > 0 is rejected at Post time (R30) and at frontend Save time.
- **Users switch sides** by clearing one field and entering the other. No value is silently discarded.
- **Auto-balance produces clean lines** — the last line gets only the side needed to close the gap.
- **Negative amounts** — not addressed in this change; existing behavior allows them through `sanitizeAmount` but the backend accepts them (no explicit negative check exists). This is a separate concern.

## 9. Remaining Limitations

- **No draft editing**: PAKO creates and posts in one operation. Users cannot save a draft, leave, and return to edit it. This is by design for the current stage.
- **Negative amounts**: Neither frontend nor backend explicitly rejects negative Debit or Credit values. This could be addressed in a future posting rule.
- **Auto-balance operates on all lines**, not just lines with accounts. The totals display only counts lines with accounts. This pre-existing discrepancy is minor and unchanged.

## 10. Manual Testing Instructions

1. Navigate to Ledger > New Journal Entry
2. **Test basic editing**: Enter Debit = 1000 on line 1, change to 600. Verify totals update.
3. **Test credit editing**: Enter Credit = 1000 on line 2, change to 400. Verify totals update.
4. **Test account splitting**: Line 1: Account A, Debit 600. Line 2: Account B, Debit 400. Line 3: Account C, Credit 1000. Verify difference = 0.
5. **Test auto-balance**: Enter two debit lines totaling 1000. Click "Auto-balance last line". Verify the last line gets Credit = 1000 (and Debit is cleared).
6. **Test dual-positive rejection**: Enter a line with both Debit = 500 and Credit = 300. Click Save. Verify error: "Line X has both Debit and Credit".
7. **Test keyboard**: Tab/Enter/Escape/arrows all navigate correctly. Values persist across cell changes.

## 11. Final Status

**BUG CONFIRMED — FIXED AND TESTED**

The core Debit/Credit editing, account splitting, and balancing were already implemented. Two issues were found and fixed:
1. Auto-balance could create lines with both Debit and Credit positive (bug).
2. No validation prevented posting such lines (missing rule R30, now added at frontend and backend).
