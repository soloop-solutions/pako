import { useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { BookmarkPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import type { ListFilterControls } from "@/components/list/useListFilters";
import { DATE_PRESET_IDS, datePresetRange, matchingDatePreset } from "@/lib/date-presets";
import { formatDisplayDate } from "@/lib/dates";
import { useAllSavedListViews } from "@/lib/list-views";
import { cn } from "@/lib/utils";

export interface RibbonSelectFilter {
  /** URL key (after `gridId.`), e.g. `partnerId`, `state`, `warehouseId`. */
  name: string;
  labelId: string;
  /** The choices, without "All" (the ribbon adds it). */
  options: SelectOption[];
  className?: string;
}

// Client request 2026-11-24: the filter ribbon every list carries — a date range with quick
// periods, the list's own selections, the active filters as removable chips, Clear, and "Save
// view" (the current filters under a name, listed in the sidebar under this page).
export function ListRibbon({
  controls,
  dateLabelId,
  selects = [],
  children,
  allowSaveView = true,
}: {
  controls: ListFilterControls;
  /** Show the from/to range (URL keys `from`/`to`) labelled with this message id. */
  dateLabelId?: string;
  selects?: RibbonSelectFilter[];
  /** Extra controls at the end of the first row (page-specific toggles). */
  children?: ReactNode;
  allowSaveView?: boolean;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { values, set, setMany, clear, activeCount, gridId, query } = controls;
  const savedViews = useAllSavedListViews();
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");

  const activePreset = dateLabelId ? matchingDatePreset(values.from ?? "", values.to ?? "") : undefined;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (dateLabelId && (values.from || values.to)) {
    const range = activePreset
      ? t(`listRibbon.preset.${activePreset}`)
      : `${values.from ? formatDisplayDate(values.from) : "…"} – ${values.to ? formatDisplayDate(values.to) : "…"}`;
    chips.push({ key: "dates", label: `${t(dateLabelId)}: ${range}`, onRemove: () => setMany({ from: "", to: "" }) });
  }
  for (const filter of selects) {
    const value = values[filter.name];
    if (!value) continue;
    const option = filter.options.find((o) => o.value === value);
    chips.push({ key: filter.name, label: `${t(filter.labelId)}: ${option?.label ?? value}`, onRemove: () => set(filter.name, "") });
  }

  function saveView() {
    if (!viewName.trim() || !query) return;
    savedViews.save(gridId, viewName, query);
    setViewName("");
    setNaming(false);
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-md border bg-muted/30 p-3" data-testid="list-ribbon">
      <div className="flex flex-wrap items-end gap-3">
        {dateLabelId && (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t("listRibbon.from")}</Label>
              <Input type="date" aria-label={t("listRibbon.from")} value={values.from ?? ""} onChange={(e) => set("from", e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t("listRibbon.to")}</Label>
              <Input type="date" aria-label={t("listRibbon.to")} value={values.to ?? ""} onChange={(e) => set("to", e.target.value)} className="w-40" />
            </div>
          </>
        )}
        {selects.map((filter) => (
          <div key={filter.name} className="flex flex-col gap-1">
            <Label className="text-xs">{t(filter.labelId)}</Label>
            <Select
              aria-label={t(filter.labelId)}
              value={values[filter.name] ?? ""}
              onValueChange={(v) => set(filter.name, v)}
              options={[{ value: "", label: t("docFilters.all") }, ...filter.options]}
              placeholder={t("docFilters.all")}
              className={filter.className ?? "w-48"}
            />
          </div>
        ))}
        {children}
        <div className="ml-auto flex items-center gap-2">
          {allowSaveView && activeCount > 0 && !naming && (
            <Button type="button" variant="outline" size="sm" onClick={() => setNaming(true)}>
              <BookmarkPlus className="size-3.5" />
              {t("listRibbon.saveView")}
            </Button>
          )}
          {naming && (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                saveView();
              }}
            >
              <Input
                autoFocus
                aria-label={t("listRibbon.viewName")}
                placeholder={t("listRibbon.viewName")}
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                className="h-8 w-48"
              />
              <Button type="submit" size="sm" disabled={!viewName.trim()}>{t("common.save")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(false)}>{t("common.cancel")}</Button>
            </form>
          )}
          {activeCount > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              {t("docFilters.clear")} ({activeCount})
            </Button>
          )}
        </div>
      </div>

      {dateLabelId && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("listRibbon.periods")}>
          <span className="mr-1 text-xs text-muted-foreground">{t(dateLabelId)}:</span>
          {DATE_PRESET_IDS.map((id) => (
            <Button
              key={id}
              type="button"
              variant={activePreset === id ? "default" : "outline"}
              size="sm"
              aria-pressed={activePreset === id}
              className="h-7 text-xs"
              onClick={() => {
                const [from, to] = datePresetRange(id);
                setMany({ from, to });
              }}
            >
              {t(`listRibbon.preset.${id}`)}
            </Button>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="list-ribbon-chips">
          {chips.map((chip) => (
            <span key={chip.key} className={cn("inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pr-1 pl-2.5 text-xs")}>
              {chip.label}
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("listRibbon.removeFilter", { filter: chip.label })}
                onClick={chip.onRemove}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
