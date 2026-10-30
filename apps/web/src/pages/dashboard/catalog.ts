import type { DashboardResponse, DashboardWidgetConfig } from "@pako/shared";

// Every widget a company can put on its dashboard: what it shows, which area of access it needs,
// the ways it can be drawn, and which of those we recommend (and why — see the
// "dashboard.widget.<key>.tip" strings). Mirrors DashboardController.Catalog on the API, which
// refuses keys and visuals not listed here.

export type Visual = "tile" | "sparkline" | "hero" | "line" | "area" | "column" | "bar" | "stacked" | "table";
export type Section = "finance" | "sales" | "purchases" | "payroll" | "hr";
export type WidgetGroup = "headline" | "trends" | "rankings" | "cash" | "people";
export type KpiFormat = "money" | "percent" | "count";

export interface WidgetDef {
  key: string;
  group: WidgetGroup;
  /** Shown when the user can see any of these areas. */
  sections: Section[];
  visuals: Visual[];
  recommended: Visual;
  defaultSize: 1 | 2 | 3 | 4;
  /** Whether the widget can draw the comparison period. */
  comparable: boolean;
  /** KPI widgets: how the value reads and whether a rise is good news. */
  kpi?: { format: KpiFormat; upIsGood: boolean };
}

const tiles: Visual[] = ["tile", "sparkline", "hero"];
const kpi = (key: string, sections: Section[], format: KpiFormat, upIsGood: boolean, recommended: Visual = "sparkline"): WidgetDef => ({
  key: `kpi.${key}`,
  group: "headline",
  sections,
  visuals: tiles,
  recommended,
  defaultSize: 1,
  comparable: true,
  kpi: { format, upIsGood },
});

export const widgetCatalog: WidgetDef[] = [
  kpi("revenue", ["finance"], "money", true),
  kpi("expenses", ["finance"], "money", false),
  kpi("netProfit", ["finance"], "money", true),
  kpi("grossProfit", ["finance"], "money", true, "tile"),
  kpi("netMargin", ["finance"], "percent", true),
  kpi("cash", ["finance"], "money", true),
  kpi("receivables", ["finance"], "money", false, "tile"),
  kpi("payables", ["finance"], "money", false, "tile"),
  { ...kpi("overdueReceivables", ["finance", "sales"], "money", false, "tile"), comparable: false },
  { ...kpi("overduePayables", ["finance", "purchases"], "money", false, "tile"), comparable: false },
  kpi("salesNet", ["sales"], "money", true),
  kpi("purchasesNet", ["purchases"], "money", false),
  kpi("invoiceCount", ["sales"], "count", true),
  kpi("averageInvoice", ["sales"], "money", true, "tile"),
  kpi("payrollCost", ["payroll"], "money", false),
  kpi("headcount", ["hr"], "count", true),
  { key: "revenueTrend", group: "trends", sections: ["finance"], visuals: ["line", "area", "column"], recommended: "line", defaultSize: 2, comparable: true },
  { key: "revenueVsExpenses", group: "trends", sections: ["finance"], visuals: ["column", "line"], recommended: "column", defaultSize: 4, comparable: false },
  { key: "profitTrend", group: "trends", sections: ["finance"], visuals: ["column", "line", "area"], recommended: "column", defaultSize: 2, comparable: true },
  { key: "cashTrend", group: "cash", sections: ["finance"], visuals: ["area", "line"], recommended: "area", defaultSize: 2, comparable: true },
  { key: "payrollTrend", group: "people", sections: ["payroll"], visuals: ["column", "line"], recommended: "column", defaultSize: 2, comparable: true },
  { key: "revenueBreakdown", group: "rankings", sections: ["finance"], visuals: ["bar", "stacked", "table"], recommended: "bar", defaultSize: 2, comparable: true },
  { key: "expenseBreakdown", group: "rankings", sections: ["finance"], visuals: ["bar", "stacked", "table"], recommended: "bar", defaultSize: 2, comparable: true },
  { key: "topCustomers", group: "rankings", sections: ["sales"], visuals: ["bar", "table"], recommended: "bar", defaultSize: 2, comparable: true },
  { key: "topVendors", group: "rankings", sections: ["purchases"], visuals: ["bar", "table"], recommended: "bar", defaultSize: 2, comparable: true },
  { key: "topItems", group: "rankings", sections: ["sales"], visuals: ["bar", "table"], recommended: "bar", defaultSize: 2, comparable: true },
  { key: "receivablesAging", group: "cash", sections: ["finance", "sales"], visuals: ["column", "stacked", "table"], recommended: "column", defaultSize: 2, comparable: false },
  { key: "payablesAging", group: "cash", sections: ["finance", "purchases"], visuals: ["column", "stacked", "table"], recommended: "column", defaultSize: 2, comparable: false },
  { key: "headcountByDepartment", group: "people", sections: ["hr"], visuals: ["bar", "table"], recommended: "bar", defaultSize: 2, comparable: true },
];

export const widgetGroups: WidgetGroup[] = ["headline", "trends", "cash", "rankings", "people"];

const byKey = new Map(widgetCatalog.map((w) => [w.key, w]));
export const widgetDef = (key: string) => byKey.get(key);

export function canShow(def: WidgetDef, sections: DashboardResponse["sections"] | undefined): boolean {
  if (!sections) return true;
  return def.sections.some((s) => sections[s]);
}

export function newWidget(key: string): DashboardWidgetConfig {
  const def = widgetDef(key)!;
  return { key, visual: def.recommended, size: def.defaultSize, showComparison: def.comparable };
}

// Starting points the company can apply and then adjust.
export const presets: { key: string; widgets: string[] }[] = [
  {
    key: "owner",
    widgets: ["kpi.revenue", "kpi.netProfit", "kpi.cash", "kpi.overdueReceivables", "revenueVsExpenses", "profitTrend", "cashTrend", "topCustomers", "expenseBreakdown", "receivablesAging", "payablesAging"],
  },
  {
    key: "sales",
    widgets: ["kpi.salesNet", "kpi.invoiceCount", "kpi.averageInvoice", "kpi.overdueReceivables", "revenueTrend", "topCustomers", "topItems", "receivablesAging"],
  },
  {
    key: "cash",
    widgets: ["kpi.cash", "kpi.receivables", "kpi.payables", "kpi.overduePayables", "cashTrend", "receivablesAging", "payablesAging", "topVendors"],
  },
  {
    key: "accountant",
    widgets: ["kpi.revenue", "kpi.expenses", "kpi.grossProfit", "kpi.netMargin", "revenueVsExpenses", "revenueBreakdown", "expenseBreakdown", "kpi.receivables", "kpi.payables", "receivablesAging", "payablesAging"],
  },
  {
    key: "people",
    widgets: ["kpi.headcount", "kpi.payrollCost", "payrollTrend", "headcountByDepartment"],
  },
];

// The layout is shared by the whole company, so a preset keeps every widget: those the editor's own
// role can't see still show for others (the editor marks them "hidden for your role").
export function presetWidgets(key: string): DashboardWidgetConfig[] {
  const preset = presets.find((p) => p.key === key);
  return (preset?.widgets ?? []).filter((k) => widgetDef(k)).map(newWidget);
}

// Suggestions shown above the dashboard: each names what we noticed and offers one click to act.
export type Suggestion =
  | { id: string; messageId: string; values?: Record<string, string>; action: { kind: "add"; key: string } }
  | { id: string; messageId: string; values?: Record<string, string>; action: { kind: "compare" } };

export function suggestionsFor(
  data: DashboardResponse | undefined,
  widgets: DashboardWidgetConfig[],
  hasComparison: boolean,
  formatMoney: (v: number) => string,
): Suggestion[] {
  if (!data) return [];
  const has = (key: string) => widgets.some((w) => w.key === key);
  const kpiValue = (key: string) => data.kpis.find((k) => k.key === key)?.current;
  const out: Suggestion[] = [];

  if (!hasComparison && widgets.some((w) => widgetDef(w.key)?.comparable)) {
    out.push({ id: "compare", messageId: "dashboard.suggest.compare", action: { kind: "compare" } });
  }
  const overdue = kpiValue("overdueReceivables");
  if (overdue && overdue > 0 && !has("receivablesAging")) {
    out.push({ id: "aging", messageId: "dashboard.suggest.receivablesAging", values: { amount: formatMoney(overdue) }, action: { kind: "add", key: "receivablesAging" } });
  }
  const overduePay = kpiValue("overduePayables");
  if (overduePay && overduePay > 0 && !has("payablesAging")) {
    out.push({ id: "payAging", messageId: "dashboard.suggest.payablesAging", values: { amount: formatMoney(overduePay) }, action: { kind: "add", key: "payablesAging" } });
  }
  const profit = kpiValue("netProfit");
  if (profit !== undefined && profit < 0 && !has("expenseBreakdown")) {
    out.push({ id: "loss", messageId: "dashboard.suggest.expenseBreakdown", action: { kind: "add", key: "expenseBreakdown" } });
  }
  if (data.sections.finance && !has("cashTrend") && !has("kpi.cash")) {
    out.push({ id: "cash", messageId: "dashboard.suggest.cash", action: { kind: "add", key: "cashTrend" } });
  }
  if (data.sections.sales && data.topItems.length > 0 && !has("topItems")) {
    out.push({ id: "items", messageId: "dashboard.suggest.topItems", action: { kind: "add", key: "topItems" } });
  }
  if (data.sections.payroll && !has("payrollTrend") && !has("kpi.payrollCost")) {
    out.push({ id: "payroll", messageId: "dashboard.suggest.payroll", action: { kind: "add", key: "payrollTrend" } });
  }
  return out.slice(0, 3);
}
