import type { KeyboardEvent } from "react";
import { useIntl } from "react-intl";

import { formatAmount } from "@/lib/payroll-enums";
import { UnitState } from "@/lib/verticals-enums";

// docs/ERP_VERTICALS_PLAN.md (POS plan P8) — helpers shared by the construction, real estate and
// rental screens (the components live in shared.tsx). Nothing here computes money.

export function useT() {
  const intl = useIntl();
  return (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
}

export const amount = formatAmount;

// "1 234,5" or "1234.5" → a number for a request body (quantities, typed prices). Not arithmetic.
export const parseNum = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));

export function usePercent() {
  const intl = useIntl();
  // The API sends ratios 0–1 (percentComplete).
  return (v: number | undefined | null) => (v == null ? "—" : intl.formatNumber(v, { style: "percent", maximumFractionDigits: 1 }));
}

// Excel keyboard model for the inline grids: Enter / ArrowDown moves to the same column one row
// down, ArrowUp one row up. Inputs carry data-row and data-col inside a [data-edit-grid] container.
export function gridKeyDown(e: KeyboardEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  const row = Number(el.dataset.row);
  const col = el.dataset.col;
  if (Number.isNaN(row) || !col) return;
  let next = row;
  if (e.key === "Enter" || e.key === "ArrowDown") next = row + 1;
  else if (e.key === "ArrowUp") next = row - 1;
  else return;
  const target = el.closest("[data-edit-grid]")?.querySelector<HTMLInputElement>(`[data-row="${next}"][data-col="${col}"]`);
  if (target) {
    e.preventDefault();
    target.focus();
    target.select();
  } else if (e.key === "Enter") {
    e.preventDefault();
  }
}

// Unit board colours, by state (colour AND a border cue).
export const unitCardClass: Record<number, string> = {
  [UnitState.Available]: "border-success-border bg-success/40",
  [UnitState.Reserved]: "border-warning-border bg-warning/40 border-l-4",
  [UnitState.Sold]: "border-border bg-muted text-muted-foreground",
  [UnitState.Compensation]: "border-dashed border-border bg-muted/60 text-muted-foreground",
  [UnitState.Rented]: "border-info-border bg-info/40 border-b-4",
};

// "2026-10-01" → "October 2026": a rent period.
export function formatMonth(intl: { formatDate: (d: Date, o: Intl.DateTimeFormatOptions) => string }, value: string | undefined) {
  return value ? intl.formatDate(new Date(`${value.slice(0, 10)}T00:00`), { month: "long", year: "numeric" }) : "—";
}
