# PAKO Urdheresa Allocation Popover UI — Audit & Fix

**Final status: BUG CONFIRMED — FIXED AND TESTED**

## Root Cause

The `DistributionEditor` was rendered as a plain `<div>` with `className="absolute right-0 top-full z-30 ..."` inside a `<div className="relative">` in a table cell. The journal entry grid's table is wrapped in `overflow-x-auto` (JournalEntryGrid.tsx line 545), which **clips** any absolutely positioned child that extends beyond the table's scroll container.

This caused three problems:

1. **Clipping** — the popover was clipped by the `overflow-x-auto` container, making content invisible when the popover extended beyond the table edge.
2. **No collision detection** — the popover always positioned `right-0 top-full` regardless of available viewport space, causing it to overflow off-screen near edges.
3. **No viewport awareness** — at narrow viewports or when the trigger was near the right edge, the fixed `w-80` (320px) width caused horizontal overflow.

## Changes Implemented

### `apps/web/src/pages/ledger/journal-grid/DistributionEditor.tsx`

Converted from a manually positioned `absolute` div to a **Radix Popover** (`@radix-ui/react-popover`):

- Uses `Popover.Portal` to render outside the grid's overflow container — eliminates clipping.
- Uses `Popover.Content` with `side="bottom"`, `align="end"`, `sideOffset={4}`, `collisionPadding={8}` — Radix automatically repositions when space is insufficient.
- Added `max-w-[calc(100vw-1rem)]` to prevent overflow on narrow viewports.
- Added `z-50` (was `z-30`) — proper z-index for a portaled popover.
- Added `max-h-48 overflow-y-auto` on the allocation rows container — prevents the popover from growing unbounded with many allocations.
- Added `shrink-0` on the percentage input, `%` sign, and remove button — prevents them from being compressed when the cost center dropdown is wide.
- Added `min-w-0` on the cost center `Select` — ensures it shrinks gracefully instead of forcing overflow.
- `onOpenAutoFocus` and `onCloseAutoFocus` both call `preventDefault()` to preserve the grid's focus model (the popover should not steal focus from the grid cell).

### `apps/web/src/pages/ledger/JournalEntryGrid.tsx`

- Added `import * as RadixPopover from "@radix-ui/react-popover"`.
- Wrapped the cost center cell in `RadixPopover.Root` + `RadixPopover.Trigger` (with `asChild`).
- The trigger button remains the same, with the same keyboard/focus handlers.
- `RadixPopover.Root` is controlled via `open={isPopoverOpen}` and `onOpenChange`.
- Removed the `<div className="relative">` wrapper — no longer needed since Radix manages positioning via its portal.

### Keyboard behavior preserved

- Escape inside the popover calls `onClose()` and `stopPropagation()` — unchanged.
- The grid's Enter/Tab/Arrow keys continue working on the cost center cell — unchanged.
- The popover's internal form controls (Select, Input, Button) remain in their own DOM subtree.

## Files Modified

| File | Change |
|------|--------|
| `apps/web/src/pages/ledger/journal-grid/DistributionEditor.tsx` | Converted to Radix Popover with portal, collision detection, scroll, responsive width |
| `apps/web/src/pages/ledger/JournalEntryGrid.tsx` | Added RadixPopover import; wrapped costCenter cell in Popover.Root/Trigger |

## Test Results

**26/26 tests pass:**

- `JournalEntryGrid.test.tsx` — 11 tests (including 2 distribution editor tests)
- `Partners.test.tsx` — 5 tests
- `Customers.test.tsx` — 5 tests
- `Vendors.test.tsx` — 5 tests

**Lint:** Clean
**TypeScript:** Clean

## UI Improvements Summary

| Issue | Before | After |
|-------|--------|-------|
| Clipping by overflow container | Popover cut off at grid edge | Portaled outside grid, fully visible |
| Viewport edge overflow | Could extend off-screen right | Radix collision detection repositions |
| Narrow viewport | Fixed 320px width overflowed | `max-w-[calc(100vw-1rem)]` caps width |
| Many allocations | Popover grew unbounded | `max-h-48` with scroll |
| Percentage input shrinking | Could compress at narrow widths | `shrink-0` prevents compression |
| z-index | `z-30` (within grid) | `z-50` (portaled layer) |

## Validation Rules Preserved

- Allocations must sum to exactly 100% when present
- Empty allocations (0 rows) are valid
- Cost center must be selected for each allocation row
- The validation message "Allocations must sum to exactly 100%, or be left empty." displays correctly

## Manual Verification Steps

1. Open the Ledger page, start a new journal entry
2. Click the cost center cell on any line
3. Verify the popover opens below the trigger, within the viewport
4. Add an allocation — verify the cost center dropdown and percentage input are usable
5. Set percentage to 5% — verify the validation message appears
6. Set percentage to 100% — verify the validation clears
7. Add multiple allocations — verify scrolling works inside the popover
8. Click Done — verify the popover closes and the summary updates
9. Press Escape — verify the popover closes
10. Scroll the grid horizontally — verify the popover repositions correctly
11. Test at narrow browser width — verify no overflow
12. Test in Albanian — verify translated labels display correctly
13. Test in dark mode — verify consistent styling
