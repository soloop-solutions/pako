import { useIntl } from "react-intl";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Lock, Plus, Sparkles, X } from "lucide-react";
import type { DashboardResponse, DashboardWidgetConfig } from "@pako/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { canShow, newWidget, presets, presetWidgets, widgetCatalog, widgetDef, widgetGroups, type WidgetDef } from "@/pages/dashboard/catalog";

// Customising the company dashboard: start from a preset, add widgets from the catalogue (each one
// says what it answers and which chart suits it best), then choose how each is drawn, its width,
// whether it shows the comparison period, and the order (drag, or the arrow buttons).
export function DashboardEditor({
  widgets,
  onChange,
  sections,
  onSave,
  onCancel,
  onReset,
  saving,
}: {
  widgets: DashboardWidgetConfig[];
  onChange: (widgets: DashboardWidgetConfig[]) => void;
  sections: DashboardResponse["sections"] | undefined;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
  saving: boolean;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const ids = widgets.map((w) => w.key);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const update = (index: number, change: Partial<DashboardWidgetConfig>) =>
    onChange(widgets.map((w, i) => (i === index ? { ...w, ...change } : w)));
  const move = (index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= widgets.length) return;
    onChange(arrayMove(widgets, index, target));
  };
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChange(arrayMove(widgets, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }

  return (
    <Card className="gap-4 border-primary/40">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("dashboard.edit.title")}</CardTitle>
          <CardDescription>{t("dashboard.edit.description")}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onReset} disabled={saving}>
            {t("dashboard.edit.reset")}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {t("dashboard.edit.save")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("dashboard.edit.presets")}</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => onChange(presetWidgets(preset.key))}
                className="flex flex-col gap-1 rounded-md border bg-card p-3 text-left hover:border-primary/60 hover:bg-accent"
              >
                <span className="text-sm font-medium">{t(`dashboard.preset.${preset.key}`)}</span>
                <span className="text-xs text-muted-foreground">{t(`dashboard.preset.${preset.key}.description`)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("dashboard.edit.onDashboard", { count: String(widgets.length) })}</h3>
          {widgets.length === 0 && <p className="text-sm text-muted-foreground">{t("dashboard.edit.empty")}</p>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-1.5">
                {widgets.map((widget, index) => (
                  <WidgetRow
                    key={widget.key}
                    widget={widget}
                    first={index === 0}
                    last={index === widgets.length - 1}
                    locked={!canShow(widgetDef(widget.key)!, sections)}
                    onChange={(change) => update(index, change)}
                    onMove={(by) => move(index, by)}
                    onRemove={() => onChange(widgets.filter((_, i) => i !== index))}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t("dashboard.edit.catalog")}</h3>
          {widgetGroups.map((group) => (
            <div key={group} className="flex flex-col gap-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`dashboard.group.${group}`)}</h4>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {widgetCatalog
                  .filter((def) => def.group === group)
                  .map((def) => (
                    <CatalogItem
                      key={def.key}
                      def={def}
                      added={ids.includes(def.key)}
                      locked={!canShow(def, sections)}
                      onAdd={() => onChange([...widgets, newWidget(def.key)])}
                    />
                  ))}
              </div>
            </div>
          ))}
        </section>
      </CardContent>
    </Card>
  );
}

function WidgetRow({
  widget,
  first,
  last,
  locked,
  onChange,
  onMove,
  onRemove,
}: {
  widget: DashboardWidgetConfig;
  first: boolean;
  last: boolean;
  locked: boolean;
  onChange: (change: Partial<DashboardWidgetConfig>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const def = widgetDef(widget.key)!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.key });
  const title = t(`dashboard.widget.${widget.key}.title`);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5 ${isDragging ? "z-10 shadow-md" : ""}`}
    >
      <button type="button" className="cursor-grab text-muted-foreground" aria-label={`${t("dashboard.edit.drag")} ${title}`} {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <span className="min-w-40 flex-1 text-sm">
        {title}
        {locked && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" />
            {t("dashboard.edit.hiddenForYou")}
          </span>
        )}
      </span>
      <Select
        className="w-44"
        aria-label={`${t("dashboard.edit.visual")} — ${title}`}
        value={widget.visual}
        onValueChange={(visual) => onChange({ visual })}
        options={def.visuals.map((v) => ({
          value: v,
          label: `${t(`dashboard.visual.${v}`)}${v === def.recommended ? ` · ${t("dashboard.edit.recommended")}` : ""}`,
        }))}
      />
      <Select
        className="w-32"
        aria-label={`${t("dashboard.edit.width")} — ${title}`}
        value={String(widget.size)}
        onValueChange={(size) => onChange({ size: Number(size) })}
        options={[1, 2, 3, 4].map((s) => ({ value: String(s), label: t(`dashboard.size.${s}`) }))}
      />
      <label className={`flex items-center gap-1.5 text-xs ${def.comparable ? "" : "invisible"}`}>
        <input type="checkbox" checked={widget.showComparison} onChange={(e) => onChange({ showComparison: e.target.checked })} disabled={!def.comparable} />
        {t("dashboard.edit.showComparison")}
      </label>
      <div className="flex">
        <Button size="icon" variant="ghost" className="size-7" aria-label={t("dashboard.edit.moveUp")} disabled={first} onClick={() => onMove(-1)}>
          <ArrowUp className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={t("dashboard.edit.moveDown")} disabled={last} onClick={() => onMove(1)}>
          <ArrowDown className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`${t("dashboard.edit.remove")} ${title}`} onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </div>
      {widget.visual !== def.recommended && (
        <p className="basis-full pl-6 text-xs text-muted-foreground">
          <Sparkles className="mr-1 inline size-3" aria-hidden />
          {t(`dashboard.widget.${widget.key}.tip`)}
        </p>
      )}
    </li>
  );
}

function CatalogItem({ def, added, locked, onAdd }: { def: WidgetDef; added: boolean; locked: boolean; onAdd: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{t(`dashboard.widget.${def.key}.title`)}</span>
        <Button size="xs" variant={added ? "ghost" : "outline"} disabled={added} onClick={onAdd} aria-label={`${t("dashboard.edit.add")} ${t(`dashboard.widget.${def.key}.title`)}`}>
          {added ? t("dashboard.edit.added") : (
            <>
              <Plus className="size-3.5" />
              {t("dashboard.edit.add")}
            </>
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t(`dashboard.widget.${def.key}.description`)}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="secondary">
          <Sparkles className="size-3" aria-hidden />
          {t("dashboard.edit.bestAs")} {t(`dashboard.visual.${def.recommended}`)}
        </Badge>
        {locked && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Lock className="size-3" />
            {t("dashboard.edit.hiddenForYou")}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t(`dashboard.widget.${def.key}.tip`)}</p>
    </div>
  );
}
