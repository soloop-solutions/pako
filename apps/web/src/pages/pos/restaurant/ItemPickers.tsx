import { useState } from "react";
import type { ComboSlotResponse, ModifierGroupResponse, PosCatalogItemResponse } from "@pako/shared";
import { Check } from "lucide-react";
import { useIntl } from "react-intl";

import { FormDialog } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const money = (v: number) => v.toFixed(2);

// A group's rule in words: "Choose 1", "Choose 1–2", "Up to 3", "Optional". MaxSelect 0 = no limit.
function ruleKey(min: number, max: number): { id: string; values: Record<string, number> } {
  if (min > 0 && max > 0) return min === max ? { id: "rest.pick.exactly", values: { n: min } } : { id: "rest.pick.between", values: { min, max } };
  if (min > 0) return { id: "rest.pick.atLeast", values: { n: min } };
  if (max > 0) return { id: "rest.pick.upTo", values: { n: max } };
  return { id: "rest.pick.optional", values: {} };
}

// Within a group's min and max: a group of one replaces the choice, otherwise a tap toggles and a
// full group takes no more. The price delta shown is the menu's own figure, never added up here.
function toggle(selected: string[], id: string, max: number): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (max === 1) return [id];
  if (max > 0 && selected.length >= max) return selected;
  return [...selected, id];
}

export function ModifierPicker({ item, groups, onPick, onCancel }: {
  item: PosCatalogItemResponse;
  groups: ModifierGroupResponse[];
  onPick: (modifierIds: string[]) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const short = groups.filter((g) => (chosen[g.id]?.length ?? 0) < g.minSelect);
  return (
    <FormDialog open onOpenChange={(open) => !open && onCancel()} title={t("rest.modifiers.title", { item: item.name })} size="md">
      <div className="flex flex-col gap-4">
        {groups.map((g) => {
          const rule = ruleKey(g.minSelect, g.maxSelect);
          const picked = chosen[g.id] ?? [];
          const missing = picked.length < g.minSelect;
          return (
            <fieldset key={g.id} className="flex flex-col gap-2" data-testid="modifier-group">
              <legend className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
                <span>{g.name}</span>
                <span className={cn("text-xs font-normal", missing ? "text-destructive" : "text-muted-foreground")}>{t(rule.id, rule.values)}</span>
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.modifiers.filter((m) => m.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map((m) => {
                  const on = picked.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setChosen((c) => ({ ...c, [g.id]: toggle(c[g.id] ?? [], m.id, g.maxSelect) }))}
                      className={cn(
                        "flex min-h-12 items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-sm hover:bg-accent",
                        on && "border-primary bg-primary/10 font-medium",
                      )}
                    >
                      <span className="flex items-center gap-1">
                        {on && <Check className="size-4" />}
                        {m.name}
                      </span>
                      {m.priceDelta !== 0 && <span className="text-xs tabular-nums text-muted-foreground">{m.priceDelta > 0 ? "+" : ""}{money(m.priceDelta)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        {short.length > 0 && <p className="text-sm text-destructive">{t("rest.modifiers.required", { groups: short.map((g) => g.name).join(", ") })}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
          <Button disabled={short.length > 0} onClick={() => onPick(groups.flatMap((g) => chosen[g.id] ?? []))}>{t("till.add")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

export interface ComboChoice {
  slotId: string;
  itemId: string;
}

// One slot at a time, in the menu's order: the guest picks a main, then a side, then a drink.
export function ComboPicker({ item, slots, catalog, onPick, onCancel }: {
  item: PosCatalogItemResponse;
  slots: ComboSlotResponse[];
  catalog: PosCatalogItemResponse[];
  onPick: (choices: ComboChoice[]) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const ordered = [...slots].sort((a, b) => a.sortOrder - b.sortOrder);
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const slot = ordered[step];
  const last = step === ordered.length - 1;
  const picked = slot ? chosen[slot.id] ?? [] : [];
  const enough = !slot || picked.length >= slot.minSelect;
  const nameOf = (itemId: string) => catalog.find((i) => i.id === itemId)?.name ?? itemId.slice(0, 8);
  const rule = slot ? ruleKey(slot.minSelect, slot.maxSelect) : null;

  function next() {
    if (!enough) return;
    if (last) onPick(ordered.flatMap((s) => (chosen[s.id] ?? []).map((itemId) => ({ slotId: s.id, itemId }))));
    else setStep((n) => n + 1);
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onCancel()} title={t("rest.combo.title", { item: item.name })} size="md">
      {slot && (
        <div className="flex flex-col gap-3" data-testid="combo-slot">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              {t("rest.combo.step", { step: step + 1, steps: ordered.length })} · {slot.name}
            </span>
            {rule && <span className={cn("text-xs", enough ? "text-muted-foreground" : "text-destructive")}>{t(rule.id, rule.values)}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slot.choices.map((c) => {
              const on = picked.includes(c.itemId);
              return (
                <button
                  key={c.itemId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChosen((all) => ({ ...all, [slot.id]: toggle(all[slot.id] ?? [], c.itemId, slot.maxSelect) }))}
                  className={cn(
                    "flex min-h-12 items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-sm hover:bg-accent",
                    on && "border-primary bg-primary/10 font-medium",
                  )}
                >
                  <span className="flex items-center gap-1">
                    {on && <Check className="size-4" />}
                    {nameOf(c.itemId)}
                  </span>
                  {c.priceDelta !== 0 && <span className="text-xs tabular-nums text-muted-foreground">{c.priceDelta > 0 ? "+" : ""}{money(c.priceDelta)}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            {step > 0 ? (
              <Button variant="outline" className="mr-auto" onClick={() => setStep((n) => n - 1)}>{t("rest.combo.back")}</Button>
            ) : null}
            <Button variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
            <Button disabled={!enough} onClick={next}>{last ? t("till.add") : t("rest.combo.next")}</Button>
          </div>
        </div>
      )}
    </FormDialog>
  );
}
