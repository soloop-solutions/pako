// Dashboard period and comparison, kept in the URL so a view is linkable and reload-safe.
// Only calendar arithmetic happens here; every figure comes from the API.
//
//   ?period=month&anchor=2026-10                → October 2026
//   ?period=quarter&anchor=2026-Q3              → Jul–Sep 2026
//   ?period=year&anchor=2026                    → 2026
//   ?period=ytd | last30 | last90 | last12m     → rolling, ending today
//   ?period=custom&from=2026-01-15&to=2026-03-10
//   &compare=none | previous | lastYear | twoYears | custom (&cfrom=…&cto=…)
//   &gran=auto | day | week | month | quarter

export type PeriodKind = "month" | "quarter" | "year" | "ytd" | "last30" | "last90" | "last12m" | "custom";
export type CompareKind = "none" | "previous" | "lastYear" | "twoYears" | "custom";
export type Granularity = "auto" | "day" | "week" | "month" | "quarter";

export const periodKinds: PeriodKind[] = ["month", "quarter", "year", "ytd", "last30", "last90", "last12m", "custom"];
export const compareKinds: CompareKind[] = ["none", "previous", "lastYear", "twoYears", "custom"];
export const granularities: Granularity[] = ["auto", "day", "week", "month", "quarter"];

export interface Range {
  from: string;
  to: string;
}

export interface DashboardPeriod {
  kind: PeriodKind;
  anchor: string;
  range: Range;
  compareKind: CompareKind;
  compare: Range | null;
  granularity: Granularity;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIso(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

const lastDay = (y: number, m: number) => new Date(y, m + 1, 0);
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

// Same calendar dates `years` earlier; 29 Feb falls back to 28 Feb.
function shiftYears(value: string, years: number): string {
  const d = parseIso(value)!;
  const y = d.getFullYear() - years;
  const day = Math.min(d.getDate(), lastDay(y, d.getMonth()).getDate());
  return iso(new Date(y, d.getMonth(), day));
}

export function defaultAnchor(kind: PeriodKind, today: Date): string {
  if (kind === "month") return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  if (kind === "quarter") return `${today.getFullYear()}-Q${Math.floor(today.getMonth() / 3) + 1}`;
  if (kind === "year") return String(today.getFullYear());
  return "";
}

export function rangeFor(kind: PeriodKind, anchor: string, today: Date, custom?: Partial<Range>): Range {
  const y = today.getFullYear();
  switch (kind) {
    case "month": {
      const match = /^(\d{4})-(\d{2})$/.exec(anchor);
      const [yy, mm] = match ? [Number(match[1]), Number(match[2]) - 1] : [y, today.getMonth()];
      return { from: iso(new Date(yy, mm, 1)), to: iso(lastDay(yy, mm)) };
    }
    case "quarter": {
      const match = /^(\d{4})-Q([1-4])$/.exec(anchor);
      const [yy, q] = match ? [Number(match[1]), Number(match[2]) - 1] : [y, Math.floor(today.getMonth() / 3)];
      return { from: iso(new Date(yy, q * 3, 1)), to: iso(lastDay(yy, q * 3 + 2)) };
    }
    case "year": {
      const yy = /^\d{4}$/.test(anchor) ? Number(anchor) : y;
      return { from: `${yy}-01-01`, to: `${yy}-12-31` };
    }
    case "ytd":
      return { from: `${y}-01-01`, to: iso(today) };
    case "last30":
      return { from: iso(addDays(today, -29)), to: iso(today) };
    case "last90":
      return { from: iso(addDays(today, -89)), to: iso(today) };
    case "last12m":
      return { from: iso(new Date(y, today.getMonth() - 11, 1)), to: iso(today) };
    case "custom": {
      const from = parseIso(custom?.from) ?? new Date(y, today.getMonth(), 1);
      const to = parseIso(custom?.to) ?? today;
      return from <= to ? { from: iso(from), to: iso(to) } : { from: iso(to), to: iso(from) };
    }
  }
}

// The comparison period. "previous" is the period of the same shape right before: the previous
// month, quarter or year for calendar periods; the same number of days before for rolling ones.
export function compareRangeFor(kind: CompareKind, period: PeriodKind, range: Range, custom?: Partial<Range>): Range | null {
  switch (kind) {
    case "none":
      return null;
    case "lastYear":
      return { from: shiftYears(range.from, 1), to: shiftYears(range.to, 1) };
    case "twoYears":
      return { from: shiftYears(range.from, 2), to: shiftYears(range.to, 2) };
    case "custom": {
      const from = parseIso(custom?.from);
      const to = parseIso(custom?.to);
      if (!from || !to) return null;
      return from <= to ? { from: iso(from), to: iso(to) } : { from: iso(to), to: iso(from) };
    }
    case "previous": {
      const from = parseIso(range.from)!;
      const to = parseIso(range.to)!;
      if (period === "month" || period === "quarter" || period === "year") {
        const months = period === "month" ? 1 : period === "quarter" ? 3 : 12;
        const start = new Date(from.getFullYear(), from.getMonth() - months, 1);
        return { from: iso(start), to: iso(lastDay(start.getFullYear(), start.getMonth() + months - 1)) };
      }
      const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
      return { from: iso(addDays(from, -days)), to: iso(addDays(from, -1)) };
    }
  }
}

export function readPeriod(params: URLSearchParams, today = new Date()): DashboardPeriod {
  const kind = (periodKinds as string[]).includes(params.get("period") ?? "") ? (params.get("period") as PeriodKind) : "month";
  const anchor = params.get("anchor") ?? defaultAnchor(kind, today);
  const range = rangeFor(kind, anchor, today, { from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
  const compareKind = (compareKinds as string[]).includes(params.get("compare") ?? "")
    ? (params.get("compare") as CompareKind)
    : "lastYear";
  const compare = compareRangeFor(compareKind, kind, range, { from: params.get("cfrom") ?? undefined, to: params.get("cto") ?? undefined });
  const granularity = (granularities as string[]).includes(params.get("gran") ?? "") ? (params.get("gran") as Granularity) : "auto";
  return { kind, anchor, range, compareKind, compare, granularity };
}

// Writes a change back into the URL params, keeping the rest of the query untouched.
export type PeriodChange = Partial<{
  kind: PeriodKind; anchor: string; from: string; to: string;
  compareKind: CompareKind; cfrom: string; cto: string; granularity: Granularity;
}>;

export function writePeriod(params: URLSearchParams, change: PeriodChange): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | undefined) => (value ? next.set(key, value) : next.delete(key));
  if (change.kind !== undefined) {
    set("period", change.kind);
    if (change.anchor === undefined) next.delete("anchor");
    if (change.kind !== "custom") {
      next.delete("from");
      next.delete("to");
    }
  }
  if (change.anchor !== undefined) set("anchor", change.anchor);
  if (change.from !== undefined) set("from", change.from);
  if (change.to !== undefined) set("to", change.to);
  if (change.compareKind !== undefined) {
    set("compare", change.compareKind);
    if (change.compareKind !== "custom") {
      next.delete("cfrom");
      next.delete("cto");
    }
  }
  if (change.cfrom !== undefined) set("cfrom", change.cfrom);
  if (change.cto !== undefined) set("cto", change.cto);
  if (change.granularity !== undefined) set("gran", change.granularity === "auto" ? undefined : change.granularity);
  return next;
}

// Anchors to pick from: the last 24 months, the last 8 quarters, the last 6 years.
export function anchorOptions(kind: PeriodKind, today: Date): string[] {
  const y = today.getFullYear();
  if (kind === "month") {
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(y, today.getMonth() - i, 1);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    });
  }
  if (kind === "quarter") {
    const q = Math.floor(today.getMonth() / 3);
    return Array.from({ length: 8 }, (_, i) => {
      const index = y * 4 + q - i;
      return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
    });
  }
  if (kind === "year") return Array.from({ length: 6 }, (_, i) => String(y - i));
  return [];
}
