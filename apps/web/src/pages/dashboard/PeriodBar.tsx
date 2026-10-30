import { useIntl } from "react-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  anchorOptions,
  compareKinds,
  granularities,
  iso,
  type CompareKind,
  type DashboardPeriod,
  type Granularity,
  type PeriodChange,
  type PeriodKind,
} from "@/pages/dashboard/period";

const mainKinds: PeriodKind[] = ["month", "quarter", "year", "custom"];
const quickKinds: PeriodKind[] = ["ytd", "last30", "last90", "last12m"];

// The one filter row above the dashboard: the period first, then what to compare it with, then the
// time step of the charts. Everything below re-renders against this slice.
export function PeriodBar({
  period,
  onChange,
  today = new Date(),
}: {
  period: DashboardPeriod;
  onChange: (change: PeriodChange) => void;
  today?: Date;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);

  const anchorLabel = (anchor: string) => {
    if (period.kind === "month") {
      const [y, m] = anchor.split("-").map(Number);
      return intl.formatDate(new Date(y, m - 1, 1), { month: "long", year: "numeric" });
    }
    return anchor.replace("-", " ");
  };
  const anchors = anchorOptions(period.kind, today);
  const anchorIndex = anchors.indexOf(period.anchor);
  const monthOf = (value: string | undefined) => (value ? value.slice(0, 7) : "");
  const endOfMonth = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    return iso(new Date(y, m, 0));
  };

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3" role="group" aria-label={t("dashboard.period.label")}>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("dashboard.period.label")}</span>
        <div className="inline-flex rounded-md border bg-card p-0.5" role="radiogroup" aria-label={t("dashboard.period.label")}>
          {mainKinds.map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={period.kind === kind}
              onClick={() => onChange({ kind })}
              className={cn(
                "h-7 rounded-[5px] px-3 text-[12.5px] font-medium",
                period.kind === kind ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {t(`dashboard.period.${kind}`)}
            </button>
          ))}
        </div>
      </div>

      {anchors.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t(`dashboard.period.which.${period.kind}`)}</span>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t("dashboard.period.earlier")}
              disabled={anchorIndex < 0 || anchorIndex >= anchors.length - 1}
              onClick={() => onChange({ anchor: anchors[anchorIndex + 1] })}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Select
              className="w-40"
              aria-label={t(`dashboard.period.which.${period.kind}`)}
              value={period.anchor}
              onValueChange={(anchor) => onChange({ anchor })}
              options={anchors.map((a) => ({ value: a, label: anchorLabel(a) }))}
            />
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t("dashboard.period.later")}
              disabled={anchorIndex <= 0}
              onClick={() => onChange({ anchor: anchors[anchorIndex - 1] })}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {period.kind === "custom" && (
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("dashboard.period.from")}
            <Input type="date" className="h-7 w-36 text-[12.5px]" value={period.range.from} max={period.range.to} onChange={(e) => e.target.value && onChange({ kind: "custom", from: e.target.value, to: period.range.to })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("dashboard.period.to")}
            <Input type="date" className="h-7 w-36 text-[12.5px]" value={period.range.to} min={period.range.from} onChange={(e) => e.target.value && onChange({ kind: "custom", from: period.range.from, to: e.target.value })} />
          </label>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("dashboard.period.quick")}</span>
        <Select
          className="w-40"
          aria-label={t("dashboard.period.quick")}
          value={quickKinds.includes(period.kind) ? period.kind : ""}
          placeholder={t("dashboard.period.quickPlaceholder")}
          onValueChange={(kind) => onChange({ kind: kind as PeriodKind })}
          options={quickKinds.map((k) => ({ value: k, label: t(`dashboard.period.${k}`) }))}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("dashboard.compare.label")}</span>
        <Select
          className="w-52"
          aria-label={t("dashboard.compare.label")}
          value={period.compareKind}
          onValueChange={(v) => onChange({ compareKind: v as CompareKind })}
          options={compareKinds.map((k) => ({ value: k, label: t(`dashboard.compare.${k}`) }))}
        />
      </div>

      {period.compareKind === "custom" && (
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("dashboard.compare.fromMonth")}
            <Input
              type="month"
              className="h-7 w-36 text-[12.5px]"
              value={monthOf(period.compare?.from)}
              onChange={(e) => e.target.value && onChange({ compareKind: "custom", cfrom: `${e.target.value}-01`, cto: period.compare?.to ?? endOfMonth(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("dashboard.compare.toMonth")}
            <Input
              type="month"
              className="h-7 w-36 text-[12.5px]"
              value={monthOf(period.compare?.to)}
              onChange={(e) => e.target.value && onChange({ compareKind: "custom", cfrom: period.compare?.from ?? `${e.target.value}-01`, cto: endOfMonth(e.target.value) })}
            />
          </label>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("dashboard.granularity.label")}</span>
        <Select
          className="w-32"
          aria-label={t("dashboard.granularity.label")}
          value={period.granularity}
          onValueChange={(v) => onChange({ granularity: v as Granularity })}
          options={granularities.map((g) => ({ value: g, label: t(`dashboard.granularity.${g}`) }))}
        />
      </div>
    </div>
  );
}
