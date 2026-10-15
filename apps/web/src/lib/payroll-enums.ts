// Pako.Api doesn't emit enum member names (see ledger-enums.ts), so PayrollAdjustmentKind arrives
// as a plain number. Order must match backend/Pako.Domain/Payroll/PayrollAdjustment.cs's
// PayrollAdjustmentKind enum exactly, by hand.
//
// Nothing in this file computes money: the multipliers below are only the defaults shown as a
// placeholder in the adjustment form (the API applies the same defaults when none is sent — see
// PayrollAdjustmentsController.DefaultMultiplier), and the month helpers only produce dates.

import type { IntlShape } from "react-intl";

export const PayrollAdjustmentKind = {
  Bonus: 0,
  Commission: 1,
  Allowance: 2,
  Overtime: 3,
  NightWork: 4,
  WeekendWork: 5,
  HolidayWork: 6,
  Deduction: 7,
} as const;

export type PayrollAdjustmentKindValue = (typeof PayrollAdjustmentKind)[keyof typeof PayrollAdjustmentKind];

const KIND_KEYS: Record<PayrollAdjustmentKindValue, string> = {
  0: "payroll.kind.bonus",
  1: "payroll.kind.commission",
  2: "payroll.kind.allowance",
  3: "payroll.kind.overtime",
  4: "payroll.kind.nightWork",
  5: "payroll.kind.weekendWork",
  6: "payroll.kind.holidayWork",
  7: "payroll.kind.deduction",
};

export const PAYROLL_ADJUSTMENT_KINDS: PayrollAdjustmentKindValue[] = [0, 1, 2, 3, 4, 5, 6, 7];

export function payrollAdjustmentKindLabel(kind: number, intl: IntlShape): string {
  const key = KIND_KEYS[kind as PayrollAdjustmentKindValue];
  return key ? intl.formatMessage({ id: key }) : String(kind);
}

// Overtime, night, weekend and holiday work are entered as hours × a rate multiplier; the API
// turns them into an amount from the employee's hourly rate when the item is saved.
export function isHourBasedKind(kind: number): boolean {
  return (
    kind === PayrollAdjustmentKind.Overtime ||
    kind === PayrollAdjustmentKind.NightWork ||
    kind === PayrollAdjustmentKind.WeekendWork ||
    kind === PayrollAdjustmentKind.HolidayWork
  );
}

export function isDeductionKind(kind: number): boolean {
  return kind === PayrollAdjustmentKind.Deduction;
}

// Labour Law 03/L-212 premiums, mirrored from KosovoPayrollRules for display only.
export function defaultRateMultiplier(kind: number): number | undefined {
  switch (kind) {
    case PayrollAdjustmentKind.Overtime:
      return 1.3;
    case PayrollAdjustmentKind.NightWork:
      return 0.2;
    case PayrollAdjustmentKind.WeekendWork:
    case PayrollAdjustmentKind.HolidayWork:
      return 0.5;
    default:
      return undefined;
  }
}

// ---- Payroll run workflow --------------------------------------------------------------------

export type PayrollRunState = "Draft" | "Approved" | "Posted" | "Paid";

export type PayrollRunAction = "recompute" | "approve" | "returnToDraft" | "post" | "pay" | "delete";

// Draft → Approved → Posted → Paid. Posting straight from Draft is allowed (small companies with
// one person doing payroll skip the approval step); Approved can go back to Draft for edits.
export function payrollRunActions(state: string): PayrollRunAction[] {
  switch (state) {
    case "Draft":
      return ["recompute", "approve", "post", "delete"];
    case "Approved":
      return ["returnToDraft", "post"];
    case "Posted":
      return ["pay"];
    default:
      return [];
  }
}

export type PayrollStateBadgeVariant = "draft" | "info" | "default" | "success" | "outline";

export function payrollRunStateBadgeVariant(state: string): PayrollStateBadgeVariant {
  switch (state) {
    case "Draft":
      return "draft";
    case "Approved":
      return "info";
    case "Posted":
      return "default";
    case "Paid":
      return "success";
    default:
      return "outline";
  }
}

const STATE_KEYS: Record<string, string> = {
  Draft: "payroll.state.draft",
  Approved: "payroll.state.approved",
  Posted: "payroll.state.posted",
  Paid: "payroll.state.paid",
};

export function payrollRunStateLabel(state: string, intl: IntlShape): string {
  const key = STATE_KEYS[state];
  return key ? intl.formatMessage({ id: key }) : state;
}

// ---- Warnings --------------------------------------------------------------------------------

const WARNING_KEYS: Record<string, string> = {
  BelowMinimumWage: "payroll.warning.belowMinimumWage",
  MissingPersonalNumber: "payroll.warning.missingPersonalNumber",
  NegativeNetPay: "payroll.warning.negativeNetPay",
  AdjustmentNotIncluded: "payroll.warning.adjustmentNotIncluded",
};

// Warnings arrive as "<Code>:<detail>" (detail is an employee name or an adjustment id). Unknown
// codes fall back to the raw string so nothing the API says is ever swallowed.
export function payrollWarningMessage(warning: string, intl: IntlShape): string {
  const separator = warning.indexOf(":");
  const code = separator >= 0 ? warning.slice(0, separator) : warning;
  const detail = separator >= 0 ? warning.slice(separator + 1) : "";
  const key = WARNING_KEYS[code];
  if (!key) return warning;
  return intl.formatMessage({ id: key }, { detail });
}

// ---- Months ----------------------------------------------------------------------------------

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function isValidMonth(month: string | null | undefined): month is string {
  if (!month) return false;
  const match = MONTH_PATTERN.exec(month);
  if (!match) return false;
  const m = Number(match[2]);
  return m >= 1 && m <= 12;
}

export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

// "2026-10" → { start: "2026-10-01", end: "2026-10-31" }
export function monthBounds(month: string): { start: string; end: string } {
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return { start: `${year}-${pad(m)}-01`, end: `${year}-${pad(m)}-${pad(lastDay)}` };
}

export function addMonths(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return monthOf(new Date(year, m - 1 + delta, 1));
}

// The month after the latest existing run; the current month when there is no run yet.
export function nextUnrunMonth(runs: { periodStart: string }[], today: Date = new Date()): string {
  if (runs.length === 0) return monthOf(today);
  const latest = runs.map((run) => run.periodStart.slice(0, 7)).sort().at(-1) as string;
  return addMonths(latest, 1);
}

export function formatPayrollMonth(monthOrDate: string, intl: IntlShape): string {
  const [year, m] = monthOrDate.slice(0, 7).split("-").map(Number);
  if (!year || !m) return monthOrDate;
  return intl.formatDate(new Date(year, m - 1, 1), { month: "long", year: "numeric" });
}

// Display only — 2 decimals, grouped, never rounded beyond what the API sent.
// Same plain two-decimal format the invoice/bill registers and the HR screens use (`toFixed(2)`),
// so a figure reads identically on the run, the payslip and the employee's annual statement.
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(2);
}
