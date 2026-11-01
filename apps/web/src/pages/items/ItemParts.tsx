import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PartDataResponse } from "@pako/shared";
import { Plus, X } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";

interface RefDraft {
  key: string;
  brand: string;
  number: string;
}

interface FitDraft {
  key: string;
  make: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  engine: string;
}

const YEAR = /^\d{4}$/;

// docs/POS_PLAN.md §6.8 / P7 auto parts: another maker's numbers for the same part (OEM,
// aftermarket) and the vehicles it fits — what the parts search at the counter finds it by.
export function ItemPartsPanel({ itemId }: { itemId: string }) {
  const intl = useIntl();
  const { activeCompanyId } = useCompany();
  const data = useQuery({
    queryKey: ["partData", activeCompanyId, itemId],
    queryFn: () => apiClient.getPartData(activeCompanyId as string, itemId),
    enabled: !!activeCompanyId,
  });
  if (data.isPending) return <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>;
  if (data.error || !data.data)
    return (
      <Alert variant="destructive">
        <AlertDescription>{getApiErrorMessage(data.error, intl.formatMessage({ id: "spec.loadError" }))}</AlertDescription>
      </Alert>
    );
  return <PartsEditor key={itemId} itemId={itemId} data={data.data} />;
}

function PartsEditor({ itemId, data }: { itemId: string; data: PartDataResponse }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const editable = canWrite("items");
  const [refs, setRefs] = useState<RefDraft[]>(() => data.references.map((r) => ({ key: r.id, brand: r.brand, number: r.number })));
  const [fits, setFits] = useState<FitDraft[]>(() =>
    data.fitments.map((f) => ({
      key: f.id, make: f.make, model: f.model, yearFrom: f.yearFrom != null ? String(f.yearFrom) : "", yearTo: f.yearTo != null ? String(f.yearTo) : "", engine: f.engine ?? "",
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      apiClient.savePartData(activeCompanyId as string, itemId, {
        references: refs.filter((r) => r.brand.trim() || r.number.trim()).map((r) => ({ brand: r.brand.trim(), number: r.number.trim() })),
        fitments: fits
          .filter((f) => f.make.trim() || f.model.trim())
          .map((f) => ({
            make: f.make.trim(), model: f.model.trim(),
            ...(f.yearFrom.trim() ? { yearFrom: Number(f.yearFrom) } : {}),
            ...(f.yearTo.trim() ? { yearTo: Number(f.yearTo) } : {}),
            ...(f.engine.trim() ? { engine: f.engine.trim() } : {}),
          })),
      }),
    onSuccess: async (result) => {
      setSaved(true);
      queryClient.setQueryData(["partData", activeCompanyId, itemId], result);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("items.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (refs.some((r) => (r.brand.trim() || r.number.trim()) && (!r.brand.trim() || !r.number.trim()))) {
      setError(t("spec.partData.refInvalid"));
      return;
    }
    const badYear = fits.some((f) => (f.yearFrom.trim() && !YEAR.test(f.yearFrom.trim())) || (f.yearTo.trim() && !YEAR.test(f.yearTo.trim())));
    if (fits.some((f) => (f.make.trim() || f.model.trim()) && (!f.make.trim() || !f.model.trim())) || badYear) {
      setError(t("spec.partData.fitInvalid"));
      return;
    }
    save.mutate();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} data-testid="item-parts">
      <p className="text-xs text-muted-foreground">{t("spec.partData.hint")}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("spec.partData.references")}</legend>
        {refs.length === 0 && <p className="text-xs text-muted-foreground">{t("spec.partData.references.empty")}</p>}
        {refs.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input aria-label={t("spec.partData.brand")} placeholder={t("spec.partData.brand")} maxLength={60} disabled={!editable} value={r.brand}
              onChange={(e) => setRefs((all) => all.map((x, j) => (j === i ? { ...x, brand: e.target.value } : x)))} />
            <Input aria-label={t("spec.partData.number")} placeholder={t("spec.partData.number")} maxLength={60} disabled={!editable} value={r.number}
              onChange={(e) => setRefs((all) => all.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
            <Button type="button" size="xs" variant="ghost" aria-label={t("common.remove")} disabled={!editable} onClick={() => setRefs((all) => all.filter((_, j) => j !== i))}>
              <X className="size-3" />
            </Button>
          </div>
        ))}
        {editable && (
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setRefs((all) => [...all, { key: crypto.randomUUID(), brand: "", number: "" }])}>
            <Plus className="size-4" /> {t("spec.partData.addReference")}
          </Button>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("spec.partData.fitments")}</legend>
        {fits.length === 0 && <p className="text-xs text-muted-foreground">{t("spec.partData.fitments.empty")}</p>}
        {fits.map((f, i) => {
          const set = (patch: Partial<FitDraft>) => setFits((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={f.key} className="grid grid-cols-[1fr_1fr_5rem_5rem_1fr_auto] gap-2">
              <Input aria-label={t("spec.parts.make")} placeholder={t("spec.parts.make")} maxLength={60} disabled={!editable} value={f.make} onChange={(e) => set({ make: e.target.value })} />
              <Input aria-label={t("spec.parts.model")} placeholder={t("spec.parts.model")} maxLength={60} disabled={!editable} value={f.model} onChange={(e) => set({ model: e.target.value })} />
              <Input aria-label={t("spec.partData.yearFrom")} placeholder={t("spec.partData.yearFrom")} inputMode="numeric" maxLength={4} disabled={!editable} value={f.yearFrom}
                onChange={(e) => set({ yearFrom: e.target.value })} className="tabular-nums" />
              <Input aria-label={t("spec.partData.yearTo")} placeholder={t("spec.partData.yearTo")} inputMode="numeric" maxLength={4} disabled={!editable} value={f.yearTo}
                onChange={(e) => set({ yearTo: e.target.value })} className="tabular-nums" />
              <Input aria-label={t("spec.partData.engine")} placeholder={t("spec.partData.engine")} maxLength={60} disabled={!editable} value={f.engine} onChange={(e) => set({ engine: e.target.value })} />
              <Button type="button" size="xs" variant="ghost" aria-label={t("common.remove")} disabled={!editable} onClick={() => setFits((all) => all.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </Button>
            </div>
          );
        })}
        {editable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => setFits((all) => [...all, { key: crypto.randomUUID(), make: "", model: "", yearFrom: "", yearTo: "", engine: "" }])}
          >
            <Plus className="size-4" /> {t("spec.partData.addFitment")}
          </Button>
        )}
      </fieldset>
      {editable && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>{save.isPending ? t("common.saving") : t("common.save")}</Button>
          {saved && <span className="text-sm text-emerald-700 dark:text-emerald-400">{t("spec.partData.saved")}</span>}
        </div>
      )}
    </form>
  );
}
