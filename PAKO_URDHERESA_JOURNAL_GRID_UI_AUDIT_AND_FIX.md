# PAKO Urdheresa: Journal Entry Grid — Complete UI/UX Audit and Fix

## 1. Page Route and Component Paths

| Item | Path |
|------|------|
| Page route | `/ledger` — rendered inside `Ledger.tsx` |
| Parent page | `apps/web/src/pages/ledger/Ledger.tsx` |
| Grid component | `apps/web/src/pages/ledger/JournalEntryGrid.tsx` |
| Picker cell | `apps/web/src/pages/ledger/journal-grid/PickerCell.tsx` |
| Distribution editor | `apps/web/src/pages/ledger/journal-grid/DistributionEditor.tsx` |
| Grid types | `apps/web/src/pages/ledger/journal-grid/types.ts` |
| Grid navigation | `apps/web/src/pages/ledger/journal-grid/gridNavigation.ts` |
| Line field commit | `apps/web/src/pages/ledger/journal-grid/lineFields.ts` |
| Balance/totals | `apps/web/src/pages/ledger/journal-grid/balance.ts` |
| Picker match/filter | `apps/web/src/pages/ledger/journal-grid/pickerMatch.ts` |
| Clipboard paste | `apps/web/src/pages/ledger/journal-grid/clipboard.ts` |
| Distribution validation | `apps/web/src/pages/ledger/journal-grid/distribution.ts` |
| Tests | `apps/web/src/pages/ledger/JournalEntryGrid.test.tsx` |
| i18n keys | `apps/web/src/i18n/messages.ts` (keys `journalGrid.*`) |
| CSS tokens | `apps/web/src/index.css` (grid-specific: `--cell-active`, `--row-selected`, `--totals`) |

## 2. Column-by-Column Audit

### Account — **ALREADY CORRECT — VERIFIED**

- Searchable via `PickerCell` — filters by code and name
- Dropdown renders in a React portal (`createPortal` to `document.body`) with fixed positioning, escaping the grid's `overflow-x-auto` container
- Flip-above logic when insufficient space below (`spaceBelow < 200`)
- Dropdown suppressed after selection (`justSelected` flag), reopens on new typing
- Keyboard: ArrowDown/Up navigate within dropdown, Enter selects highlighted, Tab/Escape go to grid
- `resolvePickerCommit` handles: exact code match > first filter match > keep previous (stray keystroke doesn't erase)
- No auto-open on empty focus (requires `value.length > 0`)

### Description — **ALREADY CORRECT — VERIFIED**

- Plain `<input type="text">`, consistent styling (`h-6`, `text-[13px]`, `border-input`)
- Values persist via `commitCellValue` on blur/Enter/Tab
- New line autofills from previous line's description (deliberate UX decision, documented)
- Copy/paste supported (including multi-cell block paste)

### Debit and Credit — **ALREADY CORRECT — VERIFIED**

- Both independently editable, no mutual exclusion
- `inputMode="decimal"` for mobile keyboard
- Right-aligned with `tabular-nums` for proper numeric column alignment
- `sanitizeAmount` normalizes comma decimals and discards unparsable values
- Totals use cent-integer arithmetic (no float dust)
- Auto-balance rewrites last line as pure single-sided entry
- Validation: dual-positive lines rejected at save time (R30)

### Partner — **ALREADY CORRECT — VERIFIED**

- Uses same `PickerCell` as Account — all dropdown behaviors identical
- Dropdown shows when typing (not on empty focus)
- Closes after selection (justSelected suppression)
- Reopens when user types new text
- `onMouseDown` (not onClick) for option selection — fires before blur, preventing dropdown close race
- Keyboard selection via ArrowDown + Enter works correctly
- Portal positioning escapes table overflow container

### Project and Employee — **ALREADY CORRECT — VERIFIED**

- Same `PickerCell` implementation as Account and Partner
- Optional fields, same keyboard and dropdown behavior

### Analytic Distribution — **BUG CONFIRMED — FIXED**

See Section 3 below for details.

### Remove Line — **ALREADY CORRECT — VERIFIED**

- Correct row removed via `filter((_, i) => i !== index)`
- Totals recalculate (reactive via `useMemo` on `lines`)
- Focus clamped via `clampCell` after removal
- Disabled when `lines.length <= 2` (minimum two lines enforced)
- Distribution popover closed on removal (`setOpenDistributionRow(null)`)

## 3. Confirmed Bugs and Fixes

### BUG 1: Analytic distribution not sent to backend API — **FIXED**

**Root cause**: The backend fully supports `AnalyticDistribution` as `Dictionary<Guid, decimal>` on `JournalEntryLine` (jsonb column, no FK constraint), and the generated API client has `analyticDistribution` on both request and response types. However, the frontend submit handler was NOT sending it — instead, it stashed allocations in a client-side mock map (`setLineDistribution` from `costCentersMockFlag.ts`), meaning distributions were lost on page reload.

**Fix**: Modified `handlePasswordConfirm` in `JournalEntryGrid.tsx` to:
1. Convert `costCenterAllocations` array to `{ [costCenterId]: percentage }` dictionary format
2. Include `analyticDistribution` in the `CreateJournalEntryLineRequest` sent to the API
3. Removed the `setLineDistribution` mock stash call and its import

### BUG 2: Outdated "mocked" column header label — **FIXED**

**Root cause**: Column header used key `journalGrid.colDistributionMocked` which reads "Analytic distribution (mocked — not yet saved to the backend)". Since the backend now supports persistence, this label was misleading.

**Fix**:
1. Added new i18n key `journalGrid.colDistribution` = "Analytic distribution" (EN) / "Shpërndarja analitike" (SQ)
2. Updated `columnHeaderKeys` in `JournalEntryGrid.tsx` to use the new key
3. Old key `journalGrid.colDistributionMocked` preserved (per convention: never delete i18n keys)
4. Updated all test references to use the new label

**Note**: Cost center *entities* are still loaded from MSW mock handlers (no `CostCentersController` exists on the backend yet). The cost center list itself remains provisional. However, the distribution *persistence* — the `{ costCenterId → percentage }` mapping on each journal line — is now wired to the real API and saved to Postgres.

## 4. Visual Consistency Audit

| Property | Grid Inputs | Status |
|----------|------------|--------|
| Height | `h-6` (24px) | Consistent across all cells |
| Font size | `text-[13px]` | Consistent |
| Border radius | `rounded-[3px]` | Consistent |
| Border color | `border-input` | Consistent |
| Focus indicator | `border-cell-active ring-2 ring-accent bg-card` | Consistent |
| Numeric alignment | `text-right tabular-nums` (debit/credit) | Correct |
| Row height | `h-[30px]` | Consistent |
| Header height | `h-[30px]` | Consistent |
| Totals row height | `h-[34px]` | Slightly taller for visual separation — correct |
| Active row highlight | `bg-row-selected shadow-[inset_3px_0_0_var(--primary)]` | Matches DataGrid pattern |
| Totals styling | `bg-totals text-totals-foreground font-bold` | Uses design tokens |
| Difference badge | `variant="warning"` (unbalanced) / `variant="success"` (balanced) | Correct |

All inputs use shared PAKO design tokens from `index.css`. No inconsistencies found.

## 5. Dropdown and Popover Positioning — **ALREADY CORRECT — VERIFIED**

- **PickerCell**: Portal to `document.body` with fixed positioning from `getBoundingClientRect()`
  - Min width: `Math.max(rect.width, 288)` — never narrower than 288px
  - Viewport clamping: `Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8))`
  - Flip-above: when `spaceBelow < 200 && rect.top > spaceBelow`
  - z-index: `z-50` — correct for portaled content
  - Max height: `max-h-[400px] overflow-auto` — scrollable when many options

- **DistributionEditor**: Radix Popover with `Popover.Portal`
  - `side="bottom"`, `align="end"`, `sideOffset={4}`, `collisionPadding={8}`
  - `max-w-[calc(100vw-1rem)]` — prevents overflow on narrow viewports
  - Radix handles collision-aware repositioning automatically
  - `onOpenAutoFocus`/`onCloseAutoFocus` prevented — preserves grid focus model

## 6. Table Layout and Responsiveness — **ALREADY CORRECT — VERIFIED**

- Outer container: `overflow-x-auto rounded-lg border` — horizontal scroll when needed
- Columns auto-size based on content
- 8 data columns + 1 remove button column
- Portable dropdowns escape the scroll container via portals
- Font: `text-[13px]` with `tabular-nums` for compact, dense display
- Header form: `sm:grid-cols-3` responsive grid for Journal/Date/Reference

## 7. Keyboard Navigation — **ALREADY CORRECT — VERIFIED**

All advertised behaviors confirmed in code and tests:

| Key | Behavior | Verified |
|-----|----------|----------|
| Enter | Commits cell, moves down; grows grid from last row | Test: "Enter commits the cell and moves down one row" |
| Tab | Commits, moves right; wraps to next row; grows grid | Test: "Tab commits and moves right, wrapping" |
| Shift+Tab | Moves left; wraps to previous row; never grows | Code: `prevForTab` |
| Escape | Reverts cell to committed value, stays in place | Test: "Escape reverts an in-progress edit" |
| Arrow keys | Move one cell in direction, clamp at edges | Code: `moveArrow` |
| ArrowDown/Up in dropdown | Navigate dropdown options (stops propagation) | Code: PickerCell `handleKeyDown` |
| Enter on dropdown option | Selects highlighted option (stops propagation) | Test: "selects a dropdown option via keyboard" |
| Paste block | Fills rows/columns from anchor, grows grid as needed | Tests: "pastes a tab/newline-separated block" |

No conflicts between grid navigation and dropdown keyboard navigation — PickerCell's `handleKeyDown` intercepts ArrowDown/Up/Enter when dropdown is open and has options, letting all other keys pass through to the grid.

## 8. Active Row and Focus States — **ALREADY CORRECT — VERIFIED**

- Active row: `bg-row-selected shadow-[inset_3px_0_0_var(--primary)]` — light blue highlight with left accent bar
- Focused cell: `border-cell-active ring-2 ring-accent bg-card` — distinct from row highlight
- Focus managed via `useEffect` on `[focus]` — re-seeds draft and moves DOM focus
- Blur guard (`blurGuardRef`) prevents double-commit when Enter/Tab already committed
- No autofocus steal on page load — initial focus is at `{ row: 0, col: 0 }` seeded at mount

## 9. Totals and Validation — **ALREADY CORRECT — VERIFIED**

- Totals exclude lines without an account (matching what Save would submit)
- Cent-integer arithmetic prevents float rounding issues
- Difference badge: `variant="warning"` when unbalanced, `variant="success"` when balanced
- Save disabled while unbalanced, with message showing exact difference amount
- Validations at save time: orphan amounts, dual-positive lines, minimum 2 lines, journal required, balance check, incomplete distributions

## 10. Files Modified

| File | Change |
|------|--------|
| `apps/web/src/pages/ledger/JournalEntryGrid.tsx` | Wire `analyticDistribution` to API; remove mock stash; update column header key |
| `apps/web/src/pages/ledger/JournalEntryGrid.test.tsx` | Update 3 test references from mocked label to new label |
| `apps/web/src/i18n/messages.ts` | Add `journalGrid.colDistribution` key (EN + SQ) |

## 11. Test Results

```
 Test Files  26 passed (26)
      Tests  150 passed (150)
```

- TypeScript: Zero errors
- ESLint: Zero warnings/errors

## 12. Remaining Limitations

1. **Cost center entities are still mocked** — The cost center LIST is served by MSW mock handlers (`costCentersHandlers.ts`). No `CostCentersController` exists on the backend. The cost center IDs in `analyticDistribution` are mock GUIDs. Once the backend gains a real CRUD controller, remove the mock infrastructure per `costCentersMockFlag.ts`'s header comments.

2. **No browser-based visual testing** — This audit is based on code inspection and automated tests. Visual verification (dropdown positioning at various viewport sizes, zoom levels, scroll positions) requires manual browser testing.

3. **Description autofill** — New lines inherit the previous line's description. `FRONTEND_BRIEF.md` notes this needs explicit sign-off ("ask Adonis from what").

## 13. Manual Verification Instructions

1. Open the Ledger page (`/ledger`)
2. In "New journal entry" grid, select a Journal
3. Type an account code (e.g. "100100") — verify dropdown appears, filtered by code
4. Select via keyboard (ArrowDown + Enter) or mouse — verify dropdown closes
5. Tab to Description, type text, Tab to Debit, enter "1000"
6. Press Enter — verify new row appears, focus moves down
7. Select another account, Tab to Credit, enter "1000"
8. Verify totals show 1000.00 / 1000.00, difference badge shows 0.00 (green)
9. Click a Partner cell, type a partner name — verify dropdown appears
10. Select partner — verify dropdown closes, value displays
11. Click the Analytic Distribution cell — verify popover opens with collision-aware positioning
12. Add allocations, verify percentage sum display
13. Press Escape — verify popover closes
14. Click "Save and post" — verify password dialog, then successful save
15. Test at narrow viewport — verify horizontal scroll, dropdowns still usable
16. Test with many lines — verify Enter/Tab grow the grid correctly

## 14. Issue Status Summary

| Issue | Status |
|-------|--------|
| Account dropdown | **ALREADY CORRECT — VERIFIED** |
| Description input | **ALREADY CORRECT — VERIFIED** |
| Debit/Credit editing | **ALREADY CORRECT — VERIFIED** |
| Partner dropdown behavior | **ALREADY CORRECT — VERIFIED** |
| Project/Employee pickers | **ALREADY CORRECT — VERIFIED** |
| Analytic distribution not saved to API | **BUG CONFIRMED — FIXED** |
| Outdated "mocked" column label | **BUG CONFIRMED — FIXED** |
| Remove line | **ALREADY CORRECT — VERIFIED** |
| Visual consistency | **ALREADY CORRECT — VERIFIED** |
| Dropdown positioning | **ALREADY CORRECT — VERIFIED** |
| Table layout/responsiveness | **ALREADY CORRECT — VERIFIED** |
| Keyboard navigation | **ALREADY CORRECT — VERIFIED** |
| Active row/focus states | **ALREADY CORRECT — VERIFIED** |
| Totals and validation | **ALREADY CORRECT — VERIFIED** |
