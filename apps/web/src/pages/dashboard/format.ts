import { useIntl, type IntlShape } from "react-intl";

import type { Format } from "@/pages/dashboard/charts";

// Display formatting for the dashboard. Numbers render exactly as the API sent them.

export interface Formatters {
  money: Format;
  compact: Format;
  count: Format;
  percent: Format;
}

export function useFormatters(): Formatters {
  const intl = useIntl();
  return {
    money: (v) => intl.formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    compact: (v) => intl.formatNumber(v, { notation: "compact", maximumFractionDigits: 1 }),
    count: (v) => intl.formatNumber(v, { maximumFractionDigits: 0 }),
    percent: (v) => `${intl.formatNumber(v, { maximumFractionDigits: 1 })}%`,
  };
}

// A bucket's axis label: "12 Oct" for days and weeks, "Oct 26" for months, "Q3 26" for quarters.
export function bucketLabel(intl: IntlShape, start: string, granularity: string): string {
  const [y, m, d] = start.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (granularity === "month") return intl.formatDate(date, { month: "short", year: "2-digit" });
  if (granularity === "quarter") return `Q${Math.floor((m - 1) / 3) + 1} ${String(y).slice(2)}`;
  return intl.formatDate(date, { day: "numeric", month: "short" });
}

export function rangeLabel(intl: IntlShape, from: string, to: string): string {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const a = parse(from);
  const b = parse(to);
  const lastOfMonth = new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate() === b.getDate();
  if (a.getDate() === 1 && lastOfMonth) {
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
      return intl.formatDate(a, { month: "long", year: "numeric" });
    }
    if (a.getMonth() === 0 && b.getMonth() === 11 && a.getFullYear() === b.getFullYear()) return String(a.getFullYear());
    if (a.getFullYear() === b.getFullYear() && a.getMonth() % 3 === 0 && b.getMonth() === a.getMonth() + 2) {
      return `Q${a.getMonth() / 3 + 1} ${a.getFullYear()}`;
    }
  }
  return intl.formatDateTimeRange(a, b, { day: "numeric", month: "short", year: "numeric" });
}
