// F9 — running totals and auto-balance. Cent-integer arithmetic throughout to avoid float dust
// (0.1 + 0.2 style errors) when summing many lines' typed amounts.

import type { GridLine } from "@/pages/ledger/journal-grid/types";

export function toCents(value: string): number {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export interface Totals {
  debit: number;
  credit: number;
  diffCents: number;
}

export function computeTotals(lines: GridLine[]): Totals {
  let debitCents = 0;
  let creditCents = 0;
  for (const line of lines) {
    debitCents += toCents(line.debit);
    creditCents += toCents(line.credit);
  }
  return { debit: debitCents / 100, credit: creditCents / 100, diffCents: debitCents - creditCents };
}

// Sets the LAST line's short side (whichever side is behind) to exactly whatever closes the
// current difference — overwriting that field's existing value, per the explicit instruction that
// auto-balance overwrites rather than adds a line. "Overwrite" here means the field ends up holding
// the one number that makes the entry balance, which is computed by absorbing whatever was already
// in that field into the new total (the only way an overwritten value can actually close the gap —
// naively writing the raw difference would double-count or ignore a pre-existing amount on that
// same field).
export function autoBalanceLastLine(lines: GridLine[]): GridLine[] {
  if (lines.length === 0) return lines;
  const { diffCents } = computeTotals(lines);
  if (diffCents === 0) return lines;

  const lastIndex = lines.length - 1;
  const last = lines[lastIndex];

  const updatedLast =
    diffCents > 0
      ? { ...last, credit: ((toCents(last.credit) + diffCents) / 100).toFixed(2) }
      : { ...last, debit: ((toCents(last.debit) + Math.abs(diffCents)) / 100).toFixed(2) };

  return lines.map((line, index) => (index === lastIndex ? updatedLast : line));
}
