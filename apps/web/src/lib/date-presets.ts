import { dateToIso } from "@/lib/dates";

// Date-range presets for the list ribbon (client request 2026-11-24). Weeks start on Monday, as in
// Kosovo. Ranges are inclusive, `yyyy-MM-dd`, and computed from `today` so tests can pin a date.
export type DatePresetId =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "last7Days"
  | "thisMonth"
  | "lastMonth"
  | "last30Days"
  | "thisQuarter"
  | "lastQuarter"
  | "thisYear"
  | "lastYear";

export const DATE_PRESET_IDS: DatePresetId[] = [
  "today",
  "yesterday",
  "thisWeek",
  "last7Days",
  "thisMonth",
  "lastMonth",
  "last30Days",
  "thisQuarter",
  "lastQuarter",
  "thisYear",
  "lastYear",
];

const day = (y: number, m: number, d: number) => dateToIso(new Date(y, m, d));

export function datePresetRange(id: DatePresetId, today: Date = new Date()): [string, string] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const quarter = Math.floor(m / 3) * 3;
  switch (id) {
    case "today":
      return [day(y, m, d), day(y, m, d)];
    case "yesterday":
      return [day(y, m, d - 1), day(y, m, d - 1)];
    case "thisWeek": {
      const sinceMonday = (today.getDay() + 6) % 7;
      return [day(y, m, d - sinceMonday), day(y, m, d - sinceMonday + 6)];
    }
    case "last7Days":
      return [day(y, m, d - 6), day(y, m, d)];
    case "thisMonth":
      return [day(y, m, 1), day(y, m + 1, 0)];
    case "lastMonth":
      return [day(y, m - 1, 1), day(y, m, 0)];
    case "last30Days":
      return [day(y, m, d - 29), day(y, m, d)];
    case "thisQuarter":
      return [day(y, quarter, 1), day(y, quarter + 3, 0)];
    case "lastQuarter":
      return [day(y, quarter - 3, 1), day(y, quarter, 0)];
    case "thisYear":
      return [`${y}-01-01`, `${y}-12-31`];
    case "lastYear":
      return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  }
}

/** The preset whose range equals [from, to], if any — so the ribbon can highlight it. */
export function matchingDatePreset(from: string, to: string, today: Date = new Date()): DatePresetId | undefined {
  if (!from || !to) return undefined;
  return DATE_PRESET_IDS.find((id) => {
    const [a, b] = datePresetRange(id, today);
    return a === from && b === to;
  });
}
