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

// Replaces the last line with the single-sided amount needed to balance the other lines. The last
// line becomes a pure balancing entry: its previous debit/credit are discarded, and only the side
// needed to close the gap is set — so a line never ends up with both debit and credit positive.
export function autoBalanceLastLine(lines: GridLine[]): GridLine[] {
  if (lines.length === 0) return lines;
  const { diffCents } = computeTotals(lines);
  if (diffCents === 0) return lines;

  const lastIndex = lines.length - 1;
  const last = lines[lastIndex];

  // Sum all lines except the last — the last line is the one we're overwriting.
  let otherDebitCents = 0;
  let otherCreditCents = 0;
  for (let i = 0; i < lastIndex; i++) {
    otherDebitCents += toCents(lines[i].debit);
    otherCreditCents += toCents(lines[i].credit);
  }
  const otherDiffCents = otherDebitCents - otherCreditCents;

  // If other lines already balance, clear the last line entirely.
  if (otherDiffCents === 0) {
    return lines.map((line, i) => (i === lastIndex ? { ...last, debit: "", credit: "" } : line));
  }

  const updatedLast =
    otherDiffCents > 0
      ? { ...last, debit: "", credit: (otherDiffCents / 100).toFixed(2) }
      : { ...last, debit: (Math.abs(otherDiffCents) / 100).toFixed(2), credit: "" };

  return lines.map((line, i) => (i === lastIndex ? updatedLast : line));
}
