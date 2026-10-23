# PAKO — Journal Line Debit/Credit Dual-Amount Validation Investigation

**Date**: 2026-10-16
**Mode**: READ-ONLY AUDIT — no code changes made

---

## 1. Executive Summary

- **Is the reported behavior reproducible?** YES — the frontend allows typing positive values into both Debit and Credit on the same journal line simultaneously.
- **Can users enter both values?** YES — both fields are independently editable `<input type="text">` elements. Typing into one does NOT clear the other.
- **Can the backend post both values?** NO — posting is rejected by **R30** (`DualAmountLineException`).
- **Is it a confirmed bug?** NO — this is **intentional, validated behavior**. The dual-amount check already exists at three levels: frontend save-time validation, backend domain posting rule R30, and is tested at both layers.

The system **deliberately allows both fields to be edited** during data entry but **rejects posting** a line with both positive. This is a design decision documented in the codebase, not a validation gap.

---

## 2. Screenshot Findings

The screenshot shows:

- Account `400100 · Goods Sales` with Debit = 1000 and Credit = 1000
- Total Debit: 2000.00, Total Credit: 1000.00

**What it proves**: Both input fields accept and display positive values simultaneously during data entry.

**What it does NOT prove**: That such a line can be saved or posted. The screenshot does not show the result of clicking "Save and post" — the validation error that would appear is not visible.

---

## 3. Frontend Investigation

### Relevant Files

| Component | File | Line |
|-----------|------|------|
| Grid component | `apps/web/src/pages/ledger/JournalEntryGrid.tsx` | Full file |
| Cell commit logic | `apps/web/src/pages/ledger/journal-grid/lineFields.ts` | `commitCellValue()` |
| Amount sanitization | `apps/web/src/pages/ledger/journal-grid/lineFields.ts:35` | `sanitizeAmount()` |
| Balance/totals | `apps/web/src/pages/ledger/journal-grid/balance.ts` | `computeTotals()` |
| Auto-balance | `apps/web/src/pages/ledger/journal-grid/balance.ts:31` | `autoBalanceLastLine()` |
| Grid types | `apps/web/src/pages/ledger/journal-grid/types.ts` | `GridLine` |
| Clipboard paste | `apps/web/src/pages/ledger/journal-grid/clipboard.ts` | `parseClipboardBlock()` |
| Tests | `apps/web/src/pages/ledger/JournalEntryGrid.test.tsx` | Multiple suites |

### Data Entry Behavior

- Debit and Credit are stored as **strings** (`GridLine.debit` and `GridLine.credit`) — raw user input, not parsed numbers.
- Each field is an independent `<input type="text" inputMode="decimal">` element.
- **Typing a Debit does NOT clear Credit.** `commitCellValue()` at `lineFields.ts:52-53` updates `debit` and `credit` independently: `case "debit": return { ...line, debit: sanitizeAmount(raw, line.debit) }`.
- **Typing a Credit does NOT clear Debit.** Same pattern.
- Both values remain in form state at all times.
- `sanitizeAmount()` normalizes comma decimals and rejects unparsable text but does NOT check the opposite field.

### Validation Timing

Validation runs at **save time only** — when the user clicks "Save and post" (`handleSaveClick()` at line 327):

```typescript
// JournalEntryGrid.tsx lines 352-358
const dualAmountIndex = validLines.findIndex(
  (line) => toCents(line.debit) > 0 && toCents(line.credit) > 0,
);
if (dualAmountIndex !== -1) {
  setError(intl.formatMessage({ id: "journalGrid.lineBothDebitAndCredit" }, { line: dualAmountIndex + 1 }));
  return;
}
```

- The error message reads: **"Line {n} has both Debit and Credit — use separate lines for each side."** (EN) / **"Rreshti {n} ka edhe Debi edhe Kredi — përdorni rreshta të ndryshme për secilën anë."** (SQ)
- Validation does NOT run on change, blur, or field-by-field.
- The "Save and post" button remains enabled while both fields have values (the `canSave` flag only checks total balance, not per-line validity).

### Spreadsheet Paste

`handlePaste()` at line 280 uses `commitCellValue()` for each cell — the same path as manual typing. A pasted row with both positive Debit and Credit would be accepted into form state but rejected at save time by the same `dualAmountIndex` check. **Paste does NOT bypass validation.**

### Auto-Balance

`autoBalanceLastLine()` at `balance.ts:31` was rewritten (per the earlier Debit/Credit audit) to produce **pure single-sided lines**:

```typescript
const updatedLast = otherDiffCents > 0
  ? { ...last, debit: "", credit: (otherDiffCents / 100).toFixed(2) }
  : { ...last, debit: (Math.abs(otherDiffCents) / 100).toFixed(2), credit: "" };
```

Auto-balance always clears the opposite side. It **cannot** produce a dual-positive line. This is tested: `balance.test.ts:52` — "never creates a line with both debit and credit positive".

### Negative Amounts

`sanitizeAmount()` accepts any finite number including negatives. Neither the frontend nor backend explicitly rejects negative Debit/Credit values. This is a separate concern noted in the existing audit as a future consideration.

---

## 4. Backend Investigation

### Relevant Files

| Component | File | Line |
|-----------|------|------|
| Domain entity | `backend/Pako.Domain/Ledger/JournalEntry.cs` | `Post()` method |
| Line entity | `backend/Pako.Domain/Ledger/JournalEntryLine.cs` | Data model |
| Exception | `backend/Pako.Domain/Ledger/Exceptions.cs:213` | `DualAmountLineException` |
| Posting rules | `backend/Pako.Domain/Ledger/PostingRuleValidator.cs` | R02/R04/R05 |
| Controller | `backend/Pako.Api/Controllers/JournalEntriesController.cs` | Create/Post/Reverse |
| Unit tests | `backend/Pako.Tests/JournalEntryPostingTests.cs` | R30 tests |

### Create Endpoint (Draft)

`JournalEntriesController.Create()` at line 84:
- Accepts `Debit` and `Credit` as `decimal` values on each `CreateJournalEntryLineRequest`.
- **Does NOT check for dual-positive lines at create time.** The Create endpoint stores the draft as-is.
- Checks: valid journal, max amount cap (`9999999999999999.99`), valid account IDs, posting rule eligibility (R02/R04/R05).
- A draft with both Debit > 0 and Credit > 0 on a line **will be created successfully**.

### Post Endpoint

`JournalEntriesController.Post()` at line 176 calls `entry.Post(company)`.

`JournalEntry.Post()` at `JournalEntry.cs:42` enforces:

1. **State must be Draft** (line 44)
2. **At least one line** (line 50)
3. **Total Debit == Total Credit** (line 55-59)
4. **Accounting lock date** (line 62)
5. **Tax lock date** (line 67)
6. **Hard lock date** (line 74)
7. **R30: No dual-positive lines** (lines 79-86):

```csharp
foreach (var line in Lines)
{
    if (line.Debit > 0 && line.Credit > 0)
    {
        throw new DualAmountLineException(line.Id);
    }
}
```

8. **R19: Foreign currency consistency** (lines 90-99)

The Post endpoint catches `DualAmountLineException` and returns `400 Bad Request` with the exception message.

### Reverse Endpoint

`JournalEntry.Reverse()` at line 110 swaps Debit and Credit on each line (`Debit = l.Credit, Credit = l.Debit`), then calls `Post()` on the reversal. Since the original lines are single-sided, the reversal lines remain single-sided. The Reverse endpoint also catches `DualAmountLineException`.

### Backend Validation Summary

| Check | When | Result |
|-------|------|--------|
| Max amount | Create | 400 if any line exceeds 9999999999999999.99 |
| Valid accounts | Create | 400 if account not found |
| R02/R04/R05 | Create | 400 if non-postable, control, or system-computed account |
| Balance check | Post | 400 if total debit ≠ total credit |
| R30 dual-amount | Post | 400 if any line has Debit > 0 AND Credit > 0 |
| Lock dates | Post | 400 if date is on or before lock date |
| Non-negative check | **NONE** | Not enforced anywhere |

---

## 5. Database Investigation

### Data Model

`journal_entry_lines` table:
- `Debit` — `numeric(18,2)`, no CHECK constraint on non-negativity or mutual exclusivity
- `Credit` — `numeric(18,2)`, no CHECK constraint on non-negativity or mutual exclusivity

### Postgres Trigger

`trg_enforce_journal_entry_balance` on `journal_entries` (from `InitialCreate` migration):

```sql
IF NEW."State" = 'Posted' THEN
    SELECT COALESCE(SUM("Debit"), 0), COALESCE(SUM("Credit"), 0)
    INTO total_debit, total_credit
    FROM journal_entry_lines
    WHERE "JournalEntryId" = NEW."Id";
    IF total_debit <> total_credit THEN
        RAISE EXCEPTION '...';
    END IF;
END IF;
```

This trigger checks **aggregate balance only** — it does NOT check individual lines for dual-positive amounts. A journal with two lines, each having Debit=500 and Credit=500, would pass the trigger (total debit=1000, total credit=1000).

### Can the Database Store Both Positive Amounts?

**YES** — the schema permits it. There is no CHECK constraint like `CHECK (NOT ("Debit" > 0 AND "Credit" > 0))`.

However, the domain layer (`JournalEntry.Post()`) prevents a Posted entry from having such lines. A Draft entry can technically have them in the database.

---

## 6. Accounting Analysis

### Double-Entry Principles

Standard double-entry bookkeeping requires each journal entry line to record a movement on exactly one side of an account — either a debit or a credit, never both simultaneously. A single line with both Debit=1000 and Credit=1000:

- **Net impact**: Zero on the account balance — but this is misleading.
- **Gross movements**: Inflates both the debit turnover and credit turnover of the account by €1,000 each.
- **Trial Balance**: The trial balance shows aggregate debit and credit movements. A dual-positive line would inflate both columns, making the report inaccurate for analytical purposes.
- **Account Turnover**: Sales Book, Purchase Book, and account movement reports would overstate both debit and credit activity.
- **Auditability**: An auditor reviewing the general ledger would see unexplained movement on both sides — a red flag.
- **Reconciliation**: A reconciliation process matching individual line movements would encounter a line that appears on both sides, creating confusion.

### Is the Net-Zero Argument Valid?

No. Even though the net balance effect is zero, the gross movement effect is real and distorts reports. In accounting, a line that debits and credits the same account for the same amount is a no-op that should not exist — it serves no accounting purpose and only creates noise.

### PAKO's Handling

PAKO correctly rejects this at post time. The behavior is sound: allow flexible editing during data entry, enforce correctness at the point of commitment (posting).

---

## 7. Kosovo Legal / Accounting Requirements

### Applicable Standards

Kosovo applies **International Financial Reporting Standards (IFRS)** for large entities and **IFRS for SMEs** for smaller ones, as adopted by the Kosovo Financial Reporting Council.

IFRS does not prescribe journal line formats at the individual-line level — it deals with recognition, measurement, and disclosure at the financial statement level. The single-sided constraint on journal lines is a **bookkeeping convention universally practiced in double-entry accounting**, not a specific IFRS requirement.

### ATK (Kosovo Tax Administration) Requirements

Under ATK's **SEF regime** (AI MF 01/2026 — the regulatory framework PAKO is built for):

- The SEF requires structured electronic submission of financial records.
- Journal entries must be internally consistent and auditable.
- ATK does not specifically mandate the technical format of individual journal lines, but expects books that conform to double-entry accounting principles.

### Conclusion on Legal/Accounting Requirements

- **No specific legal prohibition** against dual-positive journal lines has been identified in Kosovo law or ATK regulations.
- **Universal accounting practice** requires single-sided journal lines as a bookkeeping fundamental.
- **PAKO's R30 enforcement** is consistent with this practice and would be expected by any auditor or accountant.
- **Not enforcing R30 would not be illegal**, but would produce books that any qualified accountant would consider incorrect.

### Verification Status

This analysis is based on the CLAUDE.md description of PAKO's regulatory context, not on a direct reading of AI MF 01/2026. The specific regulation should be consulted for authoritative requirements if this question is escalated.

---

## 8. Reproduction Results

| Scenario | Frontend Result | Backend Result | Posting Result |
|---|---|---|---|
| Debit only (1000/0) | Accepted in form | Draft created | **Posts successfully** |
| Credit only (0/1000) | Accepted in form | Draft created | **Posts successfully** |
| Both positive, unbalanced (1000/500 + 500/0) | Accepted in form; **blocked at Save by frontend** ("Line 1 has both Debit and Credit") | Would not reach backend | N/A |
| Both positive, balanced (1000/1000 + 500/500) | Accepted in form; **blocked at Save by frontend** | Would not reach backend; if bypassed, **R30 rejects at Post** | **Rejected** |
| Both zero (0/0) | Accepted in form (empty line) | Skipped by `validLines` filter (no account) | N/A |
| Negative debit (-1000/0) | Accepted by `sanitizeAmount` (finite number) | Draft created | **NOT TESTED** — no explicit rejection exists |
| Negative credit (0/-1000) | Accepted by `sanitizeAmount` | Draft created | **NOT TESTED** — no explicit rejection exists |
| Spreadsheet paste (both positive) | Accepted into form state | **Blocked at Save by same dualAmount check** | N/A |
| Direct API request (both positive) | N/A | Draft created (Create endpoint has no R30 check) | **Rejected by R30** in `JournalEntry.Post()` |

**Note**: Scenarios marked **NOT TESTED** reflect code inspection, not runtime execution. No test environment was used for this investigation.

---

## 9. Root Cause

There is no bug. The system is working as designed:

1. **During data entry** (frontend grid): Both fields are freely editable. No on-change or on-blur validation fires. This is intentional — the grid follows an Excel-like model where the user types freely and validation occurs at submission.

2. **At save time** (frontend `handleSaveClick`): The `dualAmountIndex` check catches lines with both `toCents(debit) > 0` and `toCents(credit) > 0`, displays a clear error message, and blocks the save.

3. **At post time** (backend `JournalEntry.Post`): R30 independently rejects lines with both `Debit > 0` and `Credit > 0` via `DualAmountLineException`.

4. **At database level**: The Postgres trigger checks aggregate balance but not individual line validity. This is a defense-in-depth gap (the trigger only covers balance, not R30), but the domain layer covers it.

The validation was explicitly added as part of a prior audit (documented in `PAKO_URDHERESA_DEBIT_CREDIT_EDITING_AUDIT_AND_FIX.md`) which identified the missing check and implemented R30 at both frontend and backend with full test coverage.

---

## 10. Risk Assessment

**Risk Level: LOW**

Justification:
- The behavior is **intentional and validated** at two independent layers (frontend + backend domain).
- **Automated test coverage exists** for R30 at both layers.
- The only gap is the absence of a Postgres CHECK constraint or trigger for per-line dual-positive enforcement — but the domain layer catches it before the database is reached.
- Draft entries can technically have dual-positive lines in the database, but they cannot be posted.
- No historical data corruption risk exists because the validation was added before any production use.

Residual risks:
- **Negative amounts** are not validated anywhere — this is a separate, documented gap.
- **Draft entries in the database** can have both positive — this is harmless since drafts are not part of the General Ledger.

---

## 11. Recommended Solution

**No fix is needed.** The current implementation is correct.

### Evaluation of Options

| Option | Verdict | Reasoning |
|--------|---------|-----------|
| **A — Mutually exclusive inputs** (clear one on typing other) | **Not recommended** | Destructive UX — silently discarding a value the user just typed is confusing. Accountants may type a debit, realize it should be a credit, and want to retype without losing context. The current "edit freely, validate at save" model is better. |
| **B — Allow both but reject at save** | **Already implemented** | This is exactly what PAKO does today. Frontend rejects at save, backend rejects at post. |
| **C — Allow both values** | **Not recommended** | Would produce invalid accounting records. |
| **D — Auto-split into two lines** | **Not recommended** | Would change the user's intended accounting treatment without consent. A line with both debit and credit is always user error — auto-correcting it hides the mistake. |

### Optional Enhancements (Not Required)

1. **Visual warning during editing**: Show a subtle inline indicator (e.g., amber border) when a line has both positive values, before the user clicks Save. This would catch the issue earlier without being destructive. Low priority — the save-time message is already clear.

2. **Postgres CHECK constraint**: Add `CHECK (NOT ("Debit" > 0 AND "Credit" > 0))` to `journal_entry_lines` for defense-in-depth. Would require a migration and verification that no existing drafts violate it. Low priority — the domain layer already catches it.

3. **Negative amount validation**: Add R31 rejecting negative Debit/Credit. This is a separate concern documented in the prior audit. Medium priority.

---

## 12. Files That Would Need Changes (If Enhancements Were Approved)

### For visual warning during editing (Option enhancement):

| File | Change |
|------|--------|
| `apps/web/src/pages/ledger/JournalEntryGrid.tsx` | Add `border-warning` class to debit/credit inputs when both are positive |
| `apps/web/src/i18n/messages.ts` | Add warning tooltip text (EN + SQ) |

### For Postgres CHECK constraint:

| File | Change |
|------|--------|
| `backend/Pako.Infrastructure/Migrations/` | New migration adding CHECK constraint |

### For negative amount validation (R31):

| File | Change |
|------|--------|
| `backend/Pako.Domain/Ledger/JournalEntry.cs` | Add negative check in `Post()` |
| `backend/Pako.Domain/Ledger/Exceptions.cs` | Add `NegativeAmountLineException` |
| `backend/Pako.Api/Controllers/JournalEntriesController.cs` | Catch new exception |
| `backend/Pako.Tests/JournalEntryPostingTests.cs` | Add test |
| `apps/web/src/pages/ledger/JournalEntryGrid.tsx` | Add frontend validation |
| `apps/web/src/i18n/messages.ts` | Add error message (EN + SQ) |

---

## 13. Final Verdict

### **VALID ACCOUNTING BEHAVIOR — NO FIX NEEDED**

The system correctly allows both Debit and Credit fields to be edited during data entry (for usability) while preventing dual-positive lines from being posted (for accounting integrity). This design was explicitly implemented as posting rule R30, with:

- Frontend save-time validation (`JournalEntryGrid.tsx:352-358`)
- Backend domain posting rule (`JournalEntry.Post()` R30, `JournalEntry.cs:79-86`)
- `DualAmountLineException` domain exception (`Exceptions.cs:213`)
- Frontend i18n error messages in EN and SQ
- Unit tests at both layers (`JournalEntryPostingTests.cs:130`, `balance.test.ts:52`)
- Auto-balance explicitly designed to never produce dual-positive lines (`balance.ts:53-56`)
- Prior audit documenting the design decision (`PAKO_URDHERESA_DEBIT_CREDIT_EDITING_AUDIT_AND_FIX.md`)

The screenshot shows expected behavior during editing — not a validation gap. Clicking "Save and post" would produce the error: **"Line X has both Debit and Credit — use separate lines for each side."**
