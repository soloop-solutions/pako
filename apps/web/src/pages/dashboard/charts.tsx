import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useIntl } from "react-intl";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { niceTicks, useWidth } from "@/pages/dashboard/chart-utils";

// Dashboard charts in plain SVG/HTML, following the dataviz rules: thin marks (2px lines, bars at
// most 24px with a 4px rounded data end), hairline solid gridlines, one axis, a legend for two or
// more series, a hover/focus tooltip that lists every series, and a table twin for every chart
// (rendered by the widget frame). Colours are CSS tokens from index.css. Values are drawn exactly
// as the API returned them; the only arithmetic here is screen geometry.

export interface Series {
  name: string;
  color: string;
  values: number[];
}

export type Format = (value: number) => string;

// Every k-th label so x-axis text never collides.
function labelStride(count: number, width: number, labelWidth = 56) {
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / labelWidth))));
}

// ---- Legend & tooltip ----

export function Legend({ items, shape }: { items: { name: string; color: string }[]; shape: "line" | "rect" }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-1.5">
          {shape === "line" ? (
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: item.color }} />
          ) : (
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: item.color }} />
          )}
          {item.name}
        </li>
      ))}
    </ul>
  );
}

interface TooltipRow {
  name: string;
  color: string;
  value: string;
}

function Tooltip({ left, top, title, rows, containerWidth }: { left: number; top: number; title: string; rows: TooltipRow[]; containerWidth: number }) {
  const width = 176;
  const x = Math.min(Math.max(0, left + 12), Math.max(0, containerWidth - width));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md"
      style={{ left: x, top, width }}
    >
      <div className="mb-1 text-muted-foreground">{title}</div>
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
          <span className="font-semibold text-foreground">{row.value}</span>
          <span className="truncate text-muted-foreground">{row.name}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Time series: line / area ----

const M = { top: 10, right: 14, bottom: 22, left: 52 };

export function LineChart({
  labels,
  series,
  area = false,
  format,
  formatAxis,
  height = 200,
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  area?: boolean;
  format: Format;
  formatAxis: Format;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const plotW = Math.max(40, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const stride = labelStride(n, plotW);

  function pick(clientX: number, rect: DOMRect) {
    const px = clientX - rect.left - M.left;
    setActive(Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (px / plotW) * (n - 1)))));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight") setActive((i) => Math.min(n - 1, (i ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? 1) - 1));
    else return;
    e.preventDefault();
  }

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((i) => i ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} />
            <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-muted)" className="tnum">
              {formatAxis(t)}
            </text>
          </g>
        ))}
        {labels.map((label, i) =>
          i % stride === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle"} fontSize={11} fill="var(--chart-muted)">
              {label}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const points = s.values.map((v, i) => `${x(i)},${y(v)}`);
          if (points.length === 0) return null;
          return (
            <g key={s.name}>
              {area && points.length > 1 && (
                <path d={`M${x(0)},${y(Math.max(yMin, 0))} L${points.join(" L")} L${x(s.values.length - 1)},${y(Math.max(yMin, 0))} Z`} fill={s.color} opacity={0.1} />
              )}
              <path d={`M${points.join(" L")}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {/* End dot on the lead series: where the period finished. */}
        {series[0] && series[0].values.length > 0 && active === null && (
          <circle cx={x(series[0].values.length - 1)} cy={y(series[0].values[series[0].values.length - 1])} r={4} fill={series[0].color} stroke="var(--card)" strokeWidth={2} />
        )}
        {active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--chart-axis)" strokeWidth={1} />
            {series.map((s) =>
              s.values[active] === undefined ? null : (
                <circle key={s.name} cx={x(active)} cy={y(s.values[active])} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              ),
            )}
          </g>
        )}
      </svg>
      {active !== null && (
        <Tooltip
          left={x(active)}
          top={M.top}
          containerWidth={width}
          title={labels[active]}
          rows={series.filter((s) => s.values[active] !== undefined).map((s) => ({ name: s.name, color: s.color, value: format(s.values[active]) }))}
        />
      )}
    </div>
  );
}

// ---- Columns (grouped; negatives hang below the zero line) ----

function barPath(x: number, base: number, end: number, w: number) {
  const h = Math.abs(base - end);
  const r = Math.min(4, w / 2, h);
  if (h === 0) return "";
  if (end < base) {
    return `M${x},${base} L${x},${end + r} Q${x},${end} ${x + r},${end} L${x + w - r},${end} Q${x + w},${end} ${x + w},${end + r} L${x + w},${base} Z`;
  }
  return `M${x},${base} L${x},${end - r} Q${x},${end} ${x + r},${end} L${x + w - r},${end} Q${x + w},${end} ${x + w},${end - r} L${x + w},${base} Z`;
}

export function ColumnChart({
  labels,
  series,
  barColors,
  format,
  formatAxis,
  height = 200,
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  /** One colour per column, for a single ordered series (aging buckets). */
  barColors?: string[];
  format: Format;
  formatAxis: Format;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;
  const k = Math.max(1, series.length);
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const plotW = Math.max(40, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const band = plotW / Math.max(1, n);
  const gap = 2;
  const barW = Math.max(2, Math.min(24, (band * 0.72 - gap * (k - 1)) / k));
  const groupW = barW * k + gap * (k - 1);
  const y = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const stride = labelStride(n, plotW);

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block" onPointerLeave={() => setActive(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} />
            <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-muted)" className="tnum">
              {formatAxis(t)}
            </text>
          </g>
        ))}
        {labels.map((label, i) => {
          const cx = M.left + band * i + band / 2;
          const x0 = cx - groupW / 2;
          return (
            <g
              key={i}
              tabIndex={0}
              aria-label={`${label}: ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`).join(", ")}`}
              className="outline-none"
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              {/* The whole band is the hit target, not just the painted bar. */}
              <rect x={M.left + band * i} y={M.top} width={band} height={plotH} fill={active === i ? "var(--muted)" : "transparent"} opacity={0.6} />
              {series.map((s, si) => (
                <path
                  key={s.name}
                  d={barPath(x0 + si * (barW + gap), y(0), y(s.values[i] ?? 0), barW)}
                  fill={barColors && series.length === 1 ? barColors[i] : s.color}
                />
              ))}
              {(i % stride === 0 || i === n - 1) && (
                <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {active !== null && (
        <Tooltip
          left={M.left + band * active + band / 2}
          top={M.top}
          containerWidth={width}
          title={labels[active]}
          rows={series.map((s) => ({ name: s.name, color: barColors && series.length === 1 ? barColors[active] : s.color, value: format(s.values[active] ?? 0) }))}
        />
      )}
    </div>
  );
}

// ---- Ranked horizontal bars (top customers, items, accounts…) ----

export interface RankRow {
  name: string;
  current: number;
  previous?: number | null;
}

export function BarList({
  rows,
  currentName,
  previousName,
  showPrevious,
  format,
}: {
  rows: RankRow[];
  currentName: string;
  previousName?: string;
  showPrevious: boolean;
  format: Format;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1e-9, ...rows.flatMap((r) => [Math.abs(r.current), showPrevious ? Math.abs(r.previous ?? 0) : 0]));
  const pct = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row, i) => (
        <li
          key={`${row.name}-${i}`}
          tabIndex={0}
          className="relative grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onPointerEnter={() => setActive(i)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(i)}
          onBlur={() => setActive(null)}
        >
          <span className="truncate text-xs text-foreground" title={row.name}>
            {row.name}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="h-3 rounded-r-[4px]" style={{ width: pct(row.current), background: "var(--chart-1)", minWidth: row.current > 0 ? 2 : 0 }} />
            {showPrevious && (
              <span className="h-1.5 rounded-r-[3px]" style={{ width: pct(row.previous ?? 0), background: "var(--chart-2)", minWidth: (row.previous ?? 0) > 0 ? 2 : 0 }} />
            )}
          </span>
          <span className="text-right text-xs font-medium text-foreground tnum">{format(row.current)}</span>
          {active === i && (
            <div className="pointer-events-none absolute right-0 top-full z-10 mt-1 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
              <div className="mb-1 text-muted-foreground">{row.name}</div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ background: "var(--chart-1)" }} />
                <span className="font-semibold">{format(row.current)}</span>
                <span className="text-muted-foreground">{currentName}</span>
              </div>
              {showPrevious && previousName && (
                <div className="flex items-center gap-2">
                  <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ background: "var(--chart-2)" }} />
                  <span className="font-semibold">{format(row.previous ?? 0)}</span>
                  <span className="text-muted-foreground">{previousName}</span>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---- Part-to-whole: one stacked bar per period, 2px surface gaps between segments ----

export interface Segment {
  name: string;
  value: number;
  color: string;
}

export function StackedBar({
  bars,
  format,
}: {
  bars: { label: string; segments: Segment[] }[];
  format: Format;
}) {
  const [active, setActive] = useState<string | null>(null);
  const legend = bars[0]?.segments ?? [];
  return (
    <div className="flex flex-col gap-3">
      {bars.map((bar) => {
        const positive = bar.segments.filter((s) => s.value > 0);
        const total = positive.reduce((sum, s) => sum + s.value, 0);
        return (
          <div key={bar.label} className="flex flex-col gap-1">
            {bars.length > 1 && <span className="text-xs text-muted-foreground">{bar.label}</span>}
            <div className="relative flex h-6 w-full gap-[2px]">
              {total === 0 && <div className="h-full w-full rounded-[4px] bg-muted" />}
              {positive.map((s, i) => (
                <div
                  key={i}
                  tabIndex={0}
                  aria-label={`${s.name}: ${format(s.value)}`}
                  className={cn("h-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50", i === 0 && "rounded-l-[4px]", i === positive.length - 1 && "rounded-r-[4px]")}
                  style={{ flexGrow: s.value, flexBasis: 0, background: s.color, minWidth: 2 }}
                  onPointerEnter={() => setActive(`${bar.label}|${s.name}`)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(`${bar.label}|${s.name}`)}
                  onBlur={() => setActive(null)}
                />
              ))}
              {positive.map((s, i) =>
                active === `${bar.label}|${s.name}` ? (
                  <div key={`tip-${i}`} className="pointer-events-none absolute left-0 top-full z-10 mt-1 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      <span className="font-semibold">{format(s.value)}</span>
                      <span className="text-muted-foreground">{s.name}</span>
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          </div>
        );
      })}
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {legend.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
            <span className="truncate text-muted-foreground" title={s.name}>
              {s.name}
            </span>
            <span className="ml-auto font-medium text-foreground tnum">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Figures ----

export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => 2 + (i * (width - 6)) / (values.length - 1);
  const y = (v: number) => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <path d={`M${values.map((v, i) => `${x(i)},${y(v)}`).join(" L")}`} fill="none" stroke="var(--chart-muted)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r={3} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}

export interface Delta {
  percent: number | null | undefined;
  /** True when a rise is good news (revenue), false when it is bad (expenses). */
  upIsGood: boolean;
  label: string;
}

export function DeltaBadge({ delta }: { delta: Delta }) {
  const intl = useIntl();
  const p = delta.percent;
  if (p === null || p === undefined) {
    return <span className="text-xs text-muted-foreground">{delta.label}</span>;
  }
  const good = p === 0 ? null : (p > 0) === delta.upIsGood;
  const Icon = p > 0 ? ArrowUpRight : p < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span
        className="inline-flex items-center gap-0.5 font-semibold"
        style={{ color: good === null ? "var(--muted-foreground)" : good ? "var(--chart-delta-good)" : "var(--chart-delta-bad)" }}
      >
        <Icon className="size-3.5" aria-hidden />
        {`${p > 0 ? "+" : ""}${intl.formatNumber(p, { maximumFractionDigits: 1 })}%`}
      </span>
      <span className="text-muted-foreground">{delta.label}</span>
    </span>
  );
}

export function StatFigure({
  value,
  delta,
  trend,
  hero = false,
  footnote,
}: {
  value: string;
  delta?: Delta;
  trend?: number[];
  hero?: boolean;
  footnote?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <div className="flex items-end justify-between gap-3">
        {/* Proportional figures at display size; tabular is only for aligned columns. */}
        <span className={cn("font-semibold leading-none tracking-tight text-foreground", hero ? "text-5xl" : "text-2xl")}>{value}</span>
        {trend && <Sparkline values={trend} width={hero ? 160 : 96} height={hero ? 40 : 28} />}
      </div>
      {delta && <DeltaBadge delta={delta} />}
      {footnote}
    </div>
  );
}

// ---- Table twin: every chart's values without needing the chart ----

export function ChartTable({ columns, rows, numericFrom = 1 }: { columns: string[]; rows: string[][]; numericFrom?: number }) {
  return (
    <div className="max-h-72 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead key={i} className={cn(i >= numericFrom && "text-right")}>
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, i) => (
                <TableCell key={i} className={cn("py-1", i >= numericFrom && "text-right tnum")}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
