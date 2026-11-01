import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecipeLineResponse } from "@pako/shared";
import { Plus, Trash2 } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useItemLookup } from "@/hooks/useItemLookup";
import { ItemPicker } from "@/pages/pos/menuPickers";

interface LineDraft {
  key: string;
  ingredientItemId: string;
  quantity: string;
  wastePercent: string;
}

let seq = 0;
const nextKey = () => `r${++seq}`;
const linesFrom = (lines: RecipeLineResponse[]): LineDraft[] =>
  [...lines].sort((a, b) => a.sortOrder - b.sortOrder).map((l) => ({
    key: nextKey(), ingredientItemId: l.ingredientItemId, quantity: String(l.quantity), wastePercent: String(l.wastePercent),
  }));

// docs/POS_PLAN.md §6.2 / P3: what one unit of this item consumes — each ingredient in its own base
// unit, with a waste allowance. The till issues these on every sale; the server refuses loops
// (an ingredient whose own recipe contains this item) and says so.
export function ItemRecipePanel({ itemId }: { itemId: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const canEdit = canWrite("items");
  const queryClient = useQueryClient();
  const recipeKey = ["itemRecipe", activeCompanyId, itemId] as const;
  const recipe = useQuery({
    queryKey: recipeKey,
    queryFn: () => apiClient.getItemRecipe(activeCompanyId as string, itemId),
    enabled: !!activeCompanyId,
  });
  const [edited, setEdited] = useState<LineDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lines = useMemo(() => edited ?? linesFrom(recipe.data ?? []), [edited, recipe.data]);
  const lookup = useItemLookup(lines.map((l) => l.ingredientItemId));

  const edit = (change: (all: LineDraft[]) => LineDraft[]) => {
    setSaved(false);
    setEdited(change(lines));
  };
  const patch = (key: string, change: Partial<LineDraft>) => edit((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const save = useMutation({
    mutationFn: () =>
      apiClient.saveItemRecipe(activeCompanyId as string, itemId, {
        lines: lines.filter((l) => l.ingredientItemId).map((l) => ({
          ingredientItemId: l.ingredientItemId,
          quantity: Number(l.quantity),
          wastePercent: l.wastePercent.trim() === "" ? 0 : Number(l.wastePercent),
        })),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(recipeKey, result);
      setEdited(null);
      setSaved(true);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.setup3.recipe.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} aria-label={t("pos.setup3.recipe.tab")}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">{t("pos.setup3.recipe.hint")}</p>
      {recipe.error && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(recipe.error)}</AlertDescription>
        </Alert>
      )}
      {lines.length === 0 && !recipe.isPending && <p className="text-sm text-muted-foreground">{t("pos.setup3.recipe.empty")}</p>}
      <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
        {lines.map((l, i) => {
          const unit = lookup.find(l.ingredientItemId)?.unit;
          return (
            <div key={l.key} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_6rem_auto]" data-testid="recipe-line">
              <div className="flex flex-col gap-1">
                <Label>{t("pos.setup3.recipe.ingredient")}</Label>
                <ItemPicker
                  lookup={lookup}
                  label={t("pos.setup3.recipe.ingredient")}
                  value={l.ingredientItemId}
                  exclude={[itemId, ...lines.filter((x) => x.key !== l.key).map((x) => x.ingredientItemId)]}
                  disabled={!canEdit}
                  onChange={(id) => patch(l.key, { ingredientItemId: id })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`rc-qty-${i}`}>{unit ? t("pos.setup3.recipe.quantity.unit", { unit }) : t("pos.setup3.recipe.quantity")}</Label>
                <Input id={`rc-qty-${i}`} type="number" step="any" min="0" required value={l.quantity}
                  onChange={(e) => patch(l.key, { quantity: e.target.value })} className="text-right tabular-nums" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`rc-waste-${i}`}>{t("pos.setup3.recipe.waste")}</Label>
                <Input id={`rc-waste-${i}`} type="number" step="any" min="0" max="99.99" value={l.wastePercent}
                  onChange={(e) => patch(l.key, { wastePercent: e.target.value })} className="text-right tabular-nums" />
              </div>
              {canEdit && (
                <Button type="button" size="sm" variant="ghost" aria-label={t("pos.setup3.recipe.remove", { n: i + 1 })}
                  onClick={() => edit((all) => all.filter((x) => x.key !== l.key))}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          );
        })}
      </fieldset>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="outline"
            onClick={() => edit((all) => [...all, { key: nextKey(), ingredientItemId: "", quantity: "", wastePercent: "0" }])}>
            <Plus className="size-4" />
            {t("pos.setup3.recipe.add")}
          </Button>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-muted-foreground" role="status">{t("pos.setup3.recipe.saved")}</span>}
            <Button type="submit" size="sm" disabled={save.isPending || edited === null}>{t("pos.setup3.recipe.save")}</Button>
          </div>
        </div>
      )}
    </form>
  );
}
