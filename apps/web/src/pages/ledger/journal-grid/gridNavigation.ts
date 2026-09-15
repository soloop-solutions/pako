// F9 — pure keyboard-navigation math for the journal grid. No DOM, no React: given the currently
// focused cell and how many rows exist today, these compute where focus should land next. Kept
// separate from JournalEntryGrid.tsx so the exact transition rules (Enter grows the grid, Tab
// wraps and grows, arrows clamp without growing or wrapping) are unit-testable on their own.

import { COLUMN_COUNT, type CellPosition, type NavigationTarget } from "@/pages/ledger/journal-grid/types";

export type ArrowDirection = "up" | "down" | "left" | "right";

// Arrow keys move focus one cell in the given direction and clamp at the grid's edges — they never
// wrap to the next/previous row and never grow the grid. Tab is the only key that wraps; only
// Enter/Tab grow the grid. This split is deliberate (see JournalEntryGrid.tsx's report notes).
export function moveArrow(current: CellPosition, direction: ArrowDirection, rowCount: number): CellPosition {
  const lastRow = Math.max(rowCount - 1, 0);
  switch (direction) {
    case "up":
      return { row: Math.max(current.row - 1, 0), col: current.col };
    case "down":
      return { row: Math.min(current.row + 1, lastRow), col: current.col };
    case "left":
      return { row: current.row, col: Math.max(current.col - 1, 0) };
    case "right":
      return { row: current.row, col: Math.min(current.col + 1, COLUMN_COUNT - 1) };
  }
}

// Enter commits and moves down one row in the same column. If there is no row below, a new empty
// line is added first and focus moves into it — this is how a twelve-line entry gets keyed without
// ever touching the "Add line" button.
export function nextForEnter(current: CellPosition, rowCount: number): NavigationTarget {
  if (current.row + 1 < rowCount) {
    return { row: current.row + 1, col: current.col, grow: false };
  }
  return { row: rowCount, col: current.col, grow: true };
}

// Tab commits and moves right one column; at the last column it wraps to the first column of the
// next row, growing the grid the same way Enter does if that next row doesn't exist yet.
export function nextForTab(current: CellPosition, rowCount: number): NavigationTarget {
  if (current.col + 1 < COLUMN_COUNT) {
    return { row: current.row, col: current.col + 1, grow: false };
  }
  if (current.row + 1 < rowCount) {
    return { row: current.row + 1, col: 0, grow: false };
  }
  return { row: rowCount, col: 0, grow: true };
}

// Shift+Tab is the mirror of Tab, but never grows the grid (there is nothing to grow backwards
// into) — it clamps at the very first cell instead.
export function prevForTab(current: CellPosition): CellPosition {
  if (current.col - 1 >= 0) {
    return { row: current.row, col: current.col - 1 };
  }
  if (current.row - 1 >= 0) {
    return { row: current.row - 1, col: COLUMN_COUNT - 1 };
  }
  return { row: 0, col: 0 };
}

export function clampCell(pos: CellPosition, rowCount: number): CellPosition {
  const lastRow = Math.max(rowCount - 1, 0);
  return {
    row: Math.min(Math.max(pos.row, 0), lastRow),
    col: Math.min(Math.max(pos.col, 0), COLUMN_COUNT - 1),
  };
}
