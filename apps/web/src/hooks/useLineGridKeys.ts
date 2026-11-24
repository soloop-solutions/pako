import { useRef, type ClipboardEvent, type FocusEvent, type KeyboardEvent } from "react";

import { isMultiCellBlock, parseClipboardBlock } from "@/pages/ledger/journal-grid/clipboard";

// User decision 2026-11-24 ("yes they should"): invoice and bill lines follow the Excel keyboard model
// (frontend rule) — Enter/↓/↑ move within a column (Enter on the last line adds one), Tab on a line's
// last cell wraps to the first cell of the next line (adding one at the end), Escape puts back what the
// cell held when it was entered, and a block pasted from a spreadsheet fills the cells right and down
// from the focused one, adding lines as needed.
//
// Cells are text inputs inside an element carrying `data-line-cell="<column>"` and `data-row="<index>"`.
// `columns` lists the text columns in reading order; selects between them keep their own keys.

export type LineGridCells = Record<string, string>;

type Options = {
  columns: readonly string[];
  /** Columns holding a number: a pasted "1,234.56" or "12,5" is read as 1234.56 / 12.5. */
  numericColumns?: readonly string[];
  rowCount: number;
  addLine: () => void;
  setCell: (row: number, column: string, value: string) => void;
  /** Writes pasted values from `startRow` down, one entry per row, adding lines when needed. */
  pasteRows: (startRow: number, rows: LineGridCells[]) => void;
};

/** A pasted figure as the inputs expect it: no grouping, a point for decimals. */
export function normalizePastedNumber(text: string): string {
  const value = text.trim().replace(/[\s\u00a0\u20ac]/g, "");
  if (value.includes(",") && value.includes(".")) {
    // Whichever separator comes last is the decimal one (1,234.56 or 1.234,56).
    return value.lastIndexOf(",") > value.lastIndexOf(".")
      ? value.replace(/\./g, "").replace(",", ".")
      : value.replace(/,/g, "");
  }
  if (value.includes(",")) {
    const parts = value.split(",");
    // 1,234 (thousands) vs 12,5 (decimal comma)
    return parts.length === 2 && parts[1].length !== 3 ? `${parts[0]}.${parts[1]}` : value.replace(/,/g, "");
  }
  return value;
}

function cellOf(target: EventTarget | null): { row: number; column: string } | null {
  const element = target as HTMLElement | null;
  if (!element || element.tagName !== "INPUT") return null;
  const cell = element.closest<HTMLElement>("[data-line-cell]");
  if (!cell || cell.dataset.row == null || !cell.dataset.lineCell) return null;
  // Only the cell's own (first) input: a unit, lot or expiry field sharing the cell keeps its keys.
  if (cell.querySelector("input") !== element) return null;
  return { row: Number(cell.dataset.row), column: cell.dataset.lineCell };
}

function focusCell(row: number, column: string) {
  const input = document.querySelector<HTMLInputElement>(`[data-line-cell="${column}"][data-row="${row}"] input`);
  input?.focus();
  try {
    input?.select();
  } catch {
    // Some input types cannot select their text; focus is enough.
  }
}

export function useLineGridKeys({ columns, numericColumns = [], rowCount, addLine, setCell, pasteRows }: Options) {
  // What the focused cell held when it was entered — Escape puts it back.
  const entered = useRef<{ row: number; column: string; value: string } | null>(null);

  function moveTo(row: number, column: string, grow: boolean) {
    if (row < 0) return;
    if (row >= rowCount) {
      if (!grow) return;
      addLine();
      requestAnimationFrame(() => focusCell(row, column));
      return;
    }
    focusCell(row, column);
  }

  function onFocus(event: FocusEvent<HTMLElement>) {
    const cell = cellOf(event.target);
    entered.current = cell ? { ...cell, value: (event.target as HTMLInputElement).value } : null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const cell = cellOf(event.target);
    if (!cell) return;
    const { row, column } = cell;
    switch (event.key) {
      case "Enter":
      case "ArrowDown":
        event.preventDefault();
        moveTo(row + 1, column, event.key === "Enter");
        return;
      case "ArrowUp":
        event.preventDefault();
        moveTo(row - 1, column, false);
        return;
      case "Escape": {
        const before = entered.current;
        if (before && before.row === row && before.column === column) {
          event.preventDefault();
          event.stopPropagation();
          setCell(row, column, before.value);
        }
        return;
      }
      case "Tab": {
        const index = columns.indexOf(column);
        if (event.shiftKey) {
          if (index === 0 && row > 0) {
            event.preventDefault();
            moveTo(row - 1, columns[columns.length - 1], false);
          }
          return;
        }
        // Inside a line Tab moves on as the browser does (through the selects too); from the
        // line's last cell it wraps to the next line.
        if (index === columns.length - 1) {
          event.preventDefault();
          moveTo(row + 1, columns[0], true);
        }
        return;
      }
    }
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const cell = cellOf(event.target);
    if (!cell) return;
    const block = parseClipboardBlock(event.clipboardData.getData("text/plain"));
    if (!isMultiCellBlock(block)) return;
    event.preventDefault();
    const start = columns.indexOf(cell.column);
    if (start < 0) return;
    const rows = block.map((values) => {
      const cells: LineGridCells = {};
      values.forEach((raw, offset) => {
        const column = columns[start + offset];
        if (!column) return;
        cells[column] = numericColumns.includes(column) ? normalizePastedNumber(raw) : raw.trim();
      });
      return cells;
    });
    pasteRows(cell.row, rows);
    entered.current = null;
  }

  return { onFocus, onKeyDown, onPaste };
}
