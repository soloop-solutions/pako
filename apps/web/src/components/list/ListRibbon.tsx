import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { useIntl } from "react-intl";
import { BookmarkPlus, CalendarDays, ChevronDown, X } from "lucide-react";

import { useGridToolbarSlots } from "@/components/data-grid/toolbarSlots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
//
// User request 2026-11-24 (later): one row of equal-height controls with the label inside
// ("Customer: All"), the period as one dropdown, placed in the grid's own toolbar row next to its
// search, columns and export (components/data-grid/toolbarSlots); the chips, Clear and Save view
// make a second line only while a filter is set.
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
  /** Extra controls after the selections (page-specific toggles). */
  children?: ReactNode;
  allowSaveView?: boolean;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { values, set, setMany, clear, activeCount, gridId, query } = controls;
  const savedViews = useAllSavedListViews();
  const slots = useGridToolbarSlots(gridId);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");

  const activePreset = dateLabelId ? matchingDatePreset(values.from ?? "", values.to ?? "") : undefined;
  const rangeText =
    values.from || values.to
      ? activePreset
        ? t(`listRibbon.preset.${activePreset}`)
        : `${values.from ? formatDisplayDate(values.from) : "…"} – ${values.to ? formatDisplayDate(values.to) : "…"}`
      : null;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (dateLabelId && rangeText) {
    chips.push({ key: "dates", label: `${t(dateLabelId)}: ${rangeText}`, onRemove: () => setMany({ from: "", to: "" }) });
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

  const controlsRow = (
    <>
      {dateLabelId && (
        <PeriodFilter
          label={t(dateLabelId)}
          valueText={rangeText}
          activePreset={activePreset}
          from={values.from ?? ""}
          to={values.to ?? ""}
          onRange={(from, to) => setMany({ from, to })}
        />
      )}
      {selects.map((filter) => {
        const label = t(filter.labelId);
        return (
          <Select
            key={filter.name}
            aria-label={label}
            value={values[filter.name] ?? ""}
            onValueChange={(v) => set(filter.name, v)}
            options={[{ value: "", label: t("docFilters.all") }, ...filter.options]}
            placeholder={t("docFilters.all")}
            className={cn("h-8 w-auto min-w-32 max-w-60 text-xs", values[filter.name] && "border-primary/60 bg-primary/5")}
            renderValue={(option) => (
              <span className="truncate">
                <span className="text-muted-foreground">{label}:</span> {option?.label ?? t("docFilters.all")}
              </span>
            )}
          />
        );
      })}
      {children}
    </>
  );

  const chipsLine =
    chips.length > 0 || naming ? (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="list-ribbon-chips">
        {chips.map((chip) => (
          <span key={chip.key} className="inline-flex h-6 items-center gap-1 rounded-full border bg-background pr-1 pl-2.5 text-xs">
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
        {activeCount > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clear}>
            {t("docFilters.clear")} ({activeCount})
          </Button>
        )}
        {allowSaveView && activeCount > 0 && !naming && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setNaming(true)}>
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
              className="h-7 w-44 text-xs"
            />
            <Button type="submit" size="sm" className="h-7 text-xs" disabled={!viewName.trim()}>{t("common.save")}</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setNaming(false)}>{t("common.cancel")}</Button>
          </form>
        )}
      </div>
    ) : null;

  // In the grid's toolbar when the grid is on the page; otherwise where the ribbon is placed.
  if (slots) {
    return (
      <>
        {createPortal(controlsRow, slots.controls)}
        {chipsLine && createPortal(chipsLine, slots.chips)}
        <span hidden data-testid="list-ribbon" />
      </>
    );
  }
  return (
    <div className="mb-2 flex flex-col gap-2" data-testid="list-ribbon">
      <div className="flex flex-wrap items-center gap-2">{controlsRow}</div>
      {chipsLine}
    </div>
  );
}

/** "Date: This month ▾" — the quick periods and a custom from/to in one dropdown. */
function PeriodFilter({
  label,
  valueText,
  activePreset,
  from,
  to,
  onRange,
}: {
  label: string;
  valueText: string | null;
  activePreset: string | undefined;
  from: string;
  to: string;
  onRange: (from: string, to: string) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid="period-filter"
          className={cn(
            "inline-flex h-8 max-w-64 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs shadow-xs hover:bg-accent",
            valueText && "border-primary/60 bg-primary/5",
          )}
        >
          <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            <span className="text-muted-foreground">{label}:</span> {valueText ?? t("listRibbon.anyDate")}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-80 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div role="group" aria-label={t("listRibbon.periods")} className="flex flex-col">
            {DATE_PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={activePreset === id}
                className={cn(
                  "flex h-7 items-center rounded-sm px-2 text-left text-xs hover:bg-accent",
                  activePreset === id && "bg-accent font-medium",
                )}
                onClick={() => {
                  const [start, end] = datePresetRange(id);
                  onRange(start, end);
                  setOpen(false);
                }}
              >
                {t(`listRibbon.preset.${id}`)}
              </button>
            ))}
          </div>
          <div className="mt-1 flex flex-col gap-1.5 border-t px-1 pt-2 pb-1">
            <span className="text-[11px] text-muted-foreground">{t("listRibbon.customRange")}</span>
            <div className="flex items-center gap-1">
              <Input type="date" aria-label={t("listRibbon.from")} value={from} onChange={(e) => onRange(e.target.value, to)} className="h-7 text-xs" />
              <span className="text-xs text-muted-foreground">–</span>
              <Input type="date" aria-label={t("listRibbon.to")} value={to} onChange={(e) => onRange(from, e.target.value)} className="h-7 text-xs" />
            </div>
            {(from || to) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 justify-start px-1 text-xs"
                onClick={() => {
                  onRange("", "");
                  setOpen(false);
                }}
              >
                {t("listRibbon.anyDate")}
              </Button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
