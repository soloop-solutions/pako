import { useState } from "react";
import { useIntl, type IntlShape } from "react-intl";
import { BarChart3, Table2 } from "lucide-react";
import type { DashboardPoint, DashboardRankItem, DashboardResponse, DashboardWidgetConfig } from "@pako/shared";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { widgetDef, type KpiFormat } from "@/pages/dashboard/catalog";
import { bucketLabel, rangeLabel, useFormatters, type Formatters } from "@/pages/dashboard/format";
import { BarList, ChartTable, ColumnChart, Legend, LineChart, StackedBar, StatFigure, type Format, type Series } from "@/pages/dashboard/charts";

const categorical = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
const ordinal = ["var(--chart-ord-1)", "var(--chart-ord-2)", "var(--chart-ord-3)", "var(--chart-ord-4)", "var(--chart-ord-5)"];
const agingKeys = ["notDue", "d1to30", "d31to60", "d61to90", "d90plus"];

function rankName(intl: IntlShape, item: DashboardRankItem) {
  if (item.name === "__other") return intl.formatMessage({ id: "dashboard.other" });
  if (item.name === "__none") return intl.formatMessage({ id: "dashboard.noDepartment" });
  return item.name;
}

const formatFor = (f: Formatters, kind: KpiFormat): Format => (kind === "percent" ? f.percent : kind === "count" ? f.count : f.money);

export function WidgetCard({
  widget,
  data,
  dimmed,
}: {
  widget: DashboardWidgetConfig;
  data: DashboardResponse;
  dimmed?: boolean;
}) {
  const intl = useIntl();
  const f = useFormatters();
  const [asTable, setAsTable] = useState(widget.visual === "table");
  const def = widgetDef(widget.key);
  if (!def) return null;

  const hasCompare = widget.showComparison && def.comparable && !!data.compareSeries;
  const currentName = rangeLabel(intl, data.from, data.to);
  const previousName = data.compareFrom && data.compareTo ? rangeLabel(intl, data.compareFrom, data.compareTo) : "";
  const title = intl.formatMessage({ id: `dashboard.widget.${widget.key}.title` });
  const labels = data.series.map((p) => bucketLabel(intl, p.start, data.granularity));
  const span = { 1: "lg:col-span-1", 2: "md:col-span-2 lg:col-span-2", 3: "md:col-span-2 lg:col-span-3", 4: "md:col-span-2 lg:col-span-4" }[widget.size] ?? "lg:col-span-1";

  let subtitle = currentName;
  let body: React.ReactNode = null;
  let table: { columns: string[]; rows: string[][] } | null = null;

  // ---- KPI tiles ----
  if (def.kpi) {
    const kpi = data.kpis.find((k) => k.key === widget.key.slice(4));
    if (!kpi) return null;
    const format = formatFor(f, def.kpi.format);
    const balance = ["kpi.cash", "kpi.receivables", "kpi.payables", "kpi.overdueReceivables", "kpi.overduePayables", "kpi.headcount"].includes(widget.key);
    subtitle = balance ? intl.formatMessage({ id: "dashboard.asOf" }, { date: intl.formatDate(new Date(`${data.to}T00:00`), { dateStyle: "medium" }) }) : currentName;
    body = (
      <StatFigure
        value={def.kpi.format === "money" && Math.abs(kpi.current) >= 1_000_000 ? f.compact(kpi.current) : format(kpi.current)}
        hero={widget.visual === "hero"}
        trend={widget.visual !== "tile" && kpi.trend.length > 1 ? kpi.trend : undefined}
        delta={
          hasCompare
            ? {
                percent: kpi.changePercent,
                upIsGood: def.kpi.upIsGood,
                label: kpi.previous === undefined || kpi.previous === null
                  ? ""
                  : intl.formatMessage({ id: "dashboard.vsPrevious" }, { value: format(kpi.previous), period: previousName }),
              }
            : undefined
        }
      />
    );
    return (
      <Card className={cn("gap-2 py-4 transition-opacity", span, dimmed && "opacity-60")} data-widget={widget.key}>
        <CardHeader className="px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          <CardDescription className="text-xs">{subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">{body}</CardContent>
      </Card>
    );
  }

  // ---- Time series ----
  const pointSeries = (pick: (p: DashboardPoint) => number, name: string): Series[] => {
    const out: Series[] = [{ name, color: "var(--chart-1)", values: data.series.map(pick) }];
    if (hasCompare) out.push({ name: previousName, color: "var(--chart-2)", values: data.compareSeries!.map(pick) });
    return out;
  };
  const timeSeries: Record<string, () => Series[]> = {
    revenueTrend: () => pointSeries((p) => p.revenue, currentName),
    profitTrend: () => pointSeries((p) => p.netProfit, currentName),
    cashTrend: () => pointSeries((p) => p.cashBalance, currentName),
    payrollTrend: () => pointSeries((p) => p.payrollCost, currentName),
    revenueVsExpenses: () => [
      { name: intl.formatMessage({ id: "dashboard.series.revenue" }), color: "var(--chart-1)", values: data.series.map((p) => p.revenue) },
      { name: intl.formatMessage({ id: "dashboard.series.expenses" }), color: "var(--chart-2)", values: data.series.map((p) => p.expenses) },
    ],
  };

  if (timeSeries[widget.key]) {
    const series = timeSeries[widget.key]();
    const empty = series.every((s) => s.values.every((v) => v === 0));
    const chartLabels = series.length > 1 && hasCompare
      ? labels.map((l, i) => (data.compareSeries![i] ? `${l} · ${bucketLabel(intl, data.compareSeries![i].start, data.granularity)}` : l))
      : labels;
    if (hasCompare) subtitle = intl.formatMessage({ id: "dashboard.comparedWith" }, { current: currentName, previous: previousName });
    const n = Math.max(...series.map((s) => s.values.length));
    table = {
      columns: [intl.formatMessage({ id: "dashboard.table.period" }), ...series.map((s) => s.name)],
      rows: Array.from({ length: n }, (_, i) => [
        chartLabels[i] ?? "—",
        ...series.map((s) => (s.values[i] === undefined ? "—" : f.money(s.values[i]))),
      ]),
    };
    body = empty ? (
      <Empty />
    ) : widget.visual === "column" ? (
      <ColumnChart labels={labels} series={series} format={f.money} formatAxis={f.compact} ariaLabel={title} />
    ) : (
      <LineChart labels={labels} series={series} area={widget.visual === "area"} format={f.money} formatAxis={f.compact} ariaLabel={title} />
    );
    if (!empty) {
      body = (
        <div className="flex flex-col gap-2">
          <Legend items={series} shape={widget.visual === "column" ? "rect" : "line"} />
          {body}
        </div>
      );
    }
  }

  // ---- Rankings & breakdowns ----
  const ranks: Record<string, DashboardRankItem[]> = {
    revenueBreakdown: data.revenueByAccount,
    expenseBreakdown: data.expensesByAccount,
    topCustomers: data.topCustomers,
    topVendors: data.topVendors,
    topItems: data.topItems,
    headcountByDepartment: data.headcountByDepartment,
  };
  if (ranks[widget.key]) {
    const items = ranks[widget.key];
    const format = widget.key === "headcountByDepartment" ? f.count : f.money;
    if (widget.key === "headcountByDepartment") {
      subtitle = intl.formatMessage({ id: "dashboard.asOf" }, { date: intl.formatDate(new Date(`${data.to}T00:00`), { dateStyle: "medium" }) });
    } else if (hasCompare) {
      subtitle = intl.formatMessage({ id: "dashboard.comparedWith" }, { current: currentName, previous: previousName });
    }
    table = {
      columns: [intl.formatMessage({ id: "dashboard.table.name" }), currentName, ...(hasCompare ? [previousName] : [])],
      rows: items.map((i) => [rankName(intl, i), format(i.current), ...(hasCompare ? [format(i.previous ?? 0)] : [])]),
    };
    if (items.length === 0) body = <Empty />;
    else if (widget.visual === "stacked") {
      // Colour follows the row (slot by position in the current ranking); "other" is gray.
      const color = (item: DashboardRankItem, i: number) => (item.id ? categorical[i % categorical.length] : "var(--chart-other)");
      const bars = [{ label: currentName, segments: items.map((it, i) => ({ name: rankName(intl, it), value: it.current, color: color(it, i) })) }];
      if (hasCompare) bars.push({ label: previousName, segments: items.map((it, i) => ({ name: rankName(intl, it), value: it.previous ?? 0, color: color(it, i) })) });
      body = <StackedBar bars={bars} format={format} />;
    } else {
      body = (
        <div className="flex flex-col gap-3">
          <Legend items={hasCompare ? [{ name: currentName, color: "var(--chart-1)" }, { name: previousName, color: "var(--chart-2)" }] : []} shape="rect" />
          <BarList
            rows={items.map((i) => ({ name: rankName(intl, i), current: i.current, previous: i.previous }))}
            currentName={currentName}
            previousName={previousName}
            showPrevious={hasCompare}
            format={format}
          />
        </div>
      );
    }
  }

  // ---- Aging ----
  if (widget.key === "receivablesAging" || widget.key === "payablesAging") {
    const buckets = widget.key === "receivablesAging" ? data.receivablesAging : data.payablesAging;
    // The API measures aging at the period end, or today if the period ends later.
    const end = new Date(`${data.to}T00:00`);
    const asOf = end > new Date() ? new Date() : end;
    subtitle = intl.formatMessage({ id: "dashboard.openAt" }, { date: intl.formatDate(asOf, { dateStyle: "medium" }) });
    const names = agingKeys.map((k) => intl.formatMessage({ id: `dashboard.aging.${k}` }));
    const amounts = agingKeys.map((k) => buckets.find((b) => b.key === k)?.amount ?? 0);
    table = {
      columns: [intl.formatMessage({ id: "dashboard.table.bucket" }), intl.formatMessage({ id: "dashboard.table.amount" }), intl.formatMessage({ id: "dashboard.table.documents" })],
      rows: agingKeys.map((k, i) => [names[i], f.money(amounts[i]), f.count(buckets.find((b) => b.key === k)?.count ?? 0)]),
    };
    if (amounts.every((a) => a === 0)) body = <Empty messageId="dashboard.nothingOpen" />;
    else if (widget.visual === "stacked") {
      body = <StackedBar bars={[{ label: subtitle, segments: names.map((name, i) => ({ name, value: amounts[i], color: ordinal[i] })) }]} format={f.money} />;
    } else {
      body = <ColumnChart labels={names} series={[{ name: title, color: "var(--chart-1)", values: amounts }]} barColors={ordinal} format={f.money} formatAxis={f.compact} ariaLabel={title} />;
    }
  }

  const showTable = asTable && table;
  return (
    <Card className={cn("gap-3 py-4 transition-opacity", span, dimmed && "opacity-60")} data-widget={widget.key}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-4">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <CardDescription className="truncate text-xs">{subtitle}</CardDescription>
        </div>
        {table && (
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => setAsTable((v) => !v)}
            aria-label={intl.formatMessage({ id: showTable ? "dashboard.showChart" : "dashboard.showTable" })}
            title={intl.formatMessage({ id: showTable ? "dashboard.showChart" : "dashboard.showTable" })}
          >
            {showTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
          </button>
        )}
      </CardHeader>
      <CardContent className="px-4">{showTable ? <ChartTable columns={table!.columns} rows={table!.rows} /> : body}</CardContent>
    </Card>
  );
}

function Empty({ messageId = "dashboard.noData" }: { messageId?: string }) {
  const intl = useIntl();
  return <p className="py-8 text-center text-sm text-muted-foreground">{intl.formatMessage({ id: messageId })}</p>;
}
