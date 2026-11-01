import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ComboSlotResponse, ModifierGroupResponse, ProductionCenterResponse, SaveModifierGroupRequest } from "@pako/shared";
import { Plus, Trash2 } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosStores } from "@/hooks/usePos";
import { useUrlParam } from "@/hooks/useUrlParam";
import { PRODUCTION_CENTER_KINDS, ProductionCenterKind, productionCenterKindKey } from "@/lib/pos-enums";
import { useItemLookup } from "@/hooks/useItemLookup";
import { ItemChips, ItemPicker } from "@/pages/pos/menuPickers";

const centersKey = (companyId: string | null) => ["posProductionCenters", companyId] as const;
const groupsKey = (companyId: string | null) => ["posModifierGroups", companyId] as const;
const menuKey = (companyId: string | null) => ["posMenu", companyId] as const;

// A typed number, or undefined when blank — never arithmetic, only parsing what the user typed.
const optNumber = (v: string) => (v.trim() === "" ? undefined : Number(v));

function ErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// docs/POS_PLAN.md §6.2 / P3: the restaurant menu around the item register — where each item is
// made (production centre → printer or KDS), the modifier groups it offers and combo slots.
export function MenuSetup() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const canEdit = canApprove("pos");
  const queryClient = useQueryClient();
  const stores = usePosStores().data ?? [];
  const [editingCenter, setEditingCenter] = useState<ProductionCenterResponse | "new" | null>(null);
  const [editingGroup, setEditingGroup] = useState<ModifierGroupResponse | "new" | null>(null);

  const centersQuery = useQuery({
    queryKey: centersKey(activeCompanyId),
    queryFn: () => apiClient.listProductionCenters(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const groupsQuery = useQuery({
    queryKey: groupsKey(activeCompanyId),
    queryFn: () => apiClient.listModifierGroups(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const centers = useMemo(() => centersQuery.data ?? [], [centersQuery.data]);
  const groups = groupsQuery.data ?? [];

  const centerColumns = useMemo<ColumnDef<ProductionCenterResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("pos.setup3.center.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { id: "kind", header: t("pos.setup3.center.kind"), cell: ({ row }) => t(`pos.setup3.center.kind.${productionCenterKindKey(row.original.kind)}`) },
      {
        id: "store",
        header: t("pos.setup3.center.store"),
        cell: ({ row }) => (row.original.storeId ? stores.find((s) => s.id === row.original.storeId)?.name ?? "…" : t("pos.setup3.center.store.all")),
      },
      { accessorKey: "printerName", header: t("pos.setup3.center.printer"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, stores],
  );

  const groupColumns = useMemo<ColumnDef<ModifierGroupResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("pos.setup3.group.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { accessorKey: "minSelect", header: t("pos.setup3.group.min"), meta: { numeric: true } },
      {
        accessorKey: "maxSelect",
        header: t("pos.setup3.group.max"),
        meta: { numeric: true },
        cell: ({ getValue }) => ((getValue() as number) === 0 ? t("pos.setup3.group.max.unlimited") : (getValue() as number)),
      },
      {
        id: "modifiers",
        header: t("pos.setup3.group.modifiers"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.modifiers.filter((m) => m.isActive).map((m) => (
              <Badge key={m.id} variant="outline">{m.name}</Badge>
            ))}
          </span>
        ),
      },
      { id: "items", header: t("pos.setup3.group.itemCount"), meta: { numeric: true }, cell: ({ row }) => row.original.itemIds.length },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("pos.setup3.centers")}</CardTitle>
            <CardDescription>{t("pos.setup3.centers.description")}</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setEditingCenter("new")}>
              <Plus className="size-4" />
              {t("pos.setup3.center.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-production-centers"
            columns={centerColumns}
            data={centers}
            rowCount={centers.length}
            isLoading={centersQuery.isPending}
            getRowId={(c) => c.id}
            getRowClassName={(c) => (c.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canEdit ? setEditingCenter : undefined}
            emptyMessage={t("pos.setup3.centers.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("pos.setup3.groups")}</CardTitle>
            <CardDescription>{t("pos.setup3.groups.description")}</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setEditingGroup("new")}>
              <Plus className="size-4" />
              {t("pos.setup3.group.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-modifier-groups"
            columns={groupColumns}
            data={groups}
            rowCount={groups.length}
            isLoading={groupsQuery.isPending}
            getRowId={(g) => g.id}
            getRowClassName={(g) => (g.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canEdit ? setEditingGroup : undefined}
            emptyMessage={t("pos.setup3.groups.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <ItemMenuCard centers={centers} canEdit={canEdit} />

      {editingCenter && (
        <CenterDialog
          center={editingCenter === "new" ? null : editingCenter}
          onClose={() => setEditingCenter(null)}
          onSaved={async () => {
            setEditingCenter(null);
            await queryClient.invalidateQueries({ queryKey: centersKey(activeCompanyId) });
            await queryClient.invalidateQueries({ queryKey: menuKey(activeCompanyId) });
          }}
        />
      )}
      {editingGroup && (
        <ModifierGroupDialog
          group={editingGroup === "new" ? null : editingGroup}
          onClose={() => setEditingGroup(null)}
          onSaved={async () => {
            setEditingGroup(null);
            await queryClient.invalidateQueries({ queryKey: groupsKey(activeCompanyId) });
            await queryClient.invalidateQueries({ queryKey: menuKey(activeCompanyId) });
          }}
        />
      )}
    </div>
  );
}

function CenterDialog({ center, onClose, onSaved }: { center: ProductionCenterResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const stores = (usePosStores().data ?? []).filter((s) => s.isActive || s.id === center?.storeId);
  const [name, setName] = useState(center?.name ?? "");
  const [kind, setKind] = useState(String(center?.kind ?? ProductionCenterKind.Kitchen));
  const [storeId, setStoreId] = useState(center?.storeId ?? "");
  const [printer, setPrinter] = useState(center?.printerName ?? "");
  const [isActive, setIsActive] = useState(center?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), kind: Number(kind), storeId: storeId || undefined, printerName: printer.trim() || undefined, isActive };
      return center
        ? apiClient.updateProductionCenter(activeCompanyId as string, center.id, body)
        : apiClient.createProductionCenter(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={center ? center.name : t("pos.setup3.center.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert error={error} />
        <Field id="pc-name" label={t("pos.setup3.center.name")}>
          <Input id="pc-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pc-kind" label={t("pos.setup3.center.kind")}>
            <Select
              id="pc-kind"
              value={kind}
              onValueChange={setKind}
              options={PRODUCTION_CENTER_KINDS.map((k) => ({ value: String(k), label: t(`pos.setup3.center.kind.${productionCenterKindKey(k)}`) }))}
            />
          </Field>
          <Field id="pc-store" label={t("pos.setup3.center.store")}>
            <Select
              id="pc-store"
              value={storeId}
              onValueChange={setStoreId}
              options={[{ value: "", label: t("pos.setup3.center.store.all") }, ...stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))]}
            />
          </Field>
        </div>
        <Field id="pc-printer" label={t("pos.setup3.center.printer")} hint={t("pos.setup3.center.printer.hint")}>
          <Input id="pc-printer" maxLength={120} value={printer} onChange={(e) => setPrinter(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

interface ModifierDraft {
  key: string;
  id: string | undefined;
  name: string;
  priceDelta: string;
  ingredientItemId: string;
  ingredientQuantity: string;
  isActive: boolean;
}

let draftSeq = 0;
const nextKey = () => `d${++draftSeq}`;

function ModifierGroupDialog({ group, onClose, onSaved }: { group: ModifierGroupResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [name, setName] = useState(group?.name ?? "");
  const [min, setMin] = useState(String(group?.minSelect ?? 0));
  const [max, setMax] = useState(String(group?.maxSelect ?? 1));
  const [isActive, setIsActive] = useState(group?.isActive ?? true);
  const [modifiers, setModifiers] = useState<ModifierDraft[]>(() =>
    group && group.modifiers.length > 0
      ? group.modifiers.map((m) => ({
          key: nextKey(), id: m.id, name: m.name, priceDelta: String(m.priceDelta), ingredientItemId: m.ingredientItemId ?? "",
          ingredientQuantity: m.ingredientQuantity != null ? String(m.ingredientQuantity) : "", isActive: m.isActive,
        }))
      : [{ key: nextKey(), id: undefined, name: "", priceDelta: "0", ingredientItemId: "", ingredientQuantity: "", isActive: true }],
  );
  const [itemIds, setItemIds] = useState<string[]>(group?.itemIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const lookup = useItemLookup([...itemIds, ...modifiers.map((m) => m.ingredientItemId)]);

  const patch = (key: string, change: Partial<ModifierDraft>) => setModifiers((all) => all.map((m) => (m.key === key ? { ...m, ...change } : m)));

  const save = useMutation({
    mutationFn: () => {
      const body: SaveModifierGroupRequest = {
        name: name.trim(),
        minSelect: Number(min),
        maxSelect: Number(max),
        isActive,
        modifiers: modifiers.map((m, i) => ({
          id: m.id,
          name: m.name.trim(),
          priceDelta: Number(m.priceDelta || 0),
          ingredientItemId: m.ingredientItemId || undefined,
          ingredientQuantity: m.ingredientItemId ? optNumber(m.ingredientQuantity) : undefined,
          sortOrder: i,
          isActive: m.isActive,
        })),
        itemIds,
      };
      return group
        ? apiClient.updateModifierGroup(activeCompanyId as string, group.id, body)
        : apiClient.createModifierGroup(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (modifiers.length === 0) {
      setError(t("pos.setup3.group.noModifiers"));
      return;
    }
    if (Number(max) > 0 && Number(min) > Number(max)) {
      setError(t("pos.setup3.group.minOverMax"));
      return;
    }
    save.mutate();
  }

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={group ? group.name : t("pos.setup3.group.new")} size="lg">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert error={error} />
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem]">
          <Field id="mg-name" label={t("pos.setup3.group.name")}>
            <Input id="mg-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="mg-min" label={t("pos.setup3.group.min")}>
            <Input id="mg-min" type="number" min={0} required value={min} onChange={(e) => setMin(e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field id="mg-max" label={t("pos.setup3.group.max")}>
            <Input id="mg-max" type="number" min={0} required value={max} onChange={(e) => setMax(e.target.value)} className="text-right tabular-nums" />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t("pos.setup3.group.minMax.hint")}</p>

        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{t("pos.setup3.group.modifiers")}</legend>
          <p className="text-xs text-muted-foreground">{t("pos.setup3.modifier.hint")}</p>
          {modifiers.map((m, i) => {
            const unit = lookup.find(m.ingredientItemId)?.unit;
            return (
              <div key={m.key} className="grid items-end gap-2 sm:grid-cols-[1fr_6rem_1fr_6rem_auto_auto]" data-testid="modifier-row">
                <Field id={`md-name-${i}`} label={t("pos.setup3.modifier.name")}>
                  <Input id={`md-name-${i}`} required maxLength={80} value={m.name} onChange={(e) => patch(m.key, { name: e.target.value })} />
                </Field>
                <Field id={`md-price-${i}`} label={t("pos.setup3.modifier.price")}>
                  <Input id={`md-price-${i}`} type="number" step="0.01" value={m.priceDelta} onChange={(e) => patch(m.key, { priceDelta: e.target.value })} className="text-right tabular-nums" />
                </Field>
                <Field label={t("pos.setup3.modifier.ingredient")}>
                  <ItemPicker
                    lookup={lookup}
                    label={t("pos.setup3.modifier.ingredient")}
                    value={m.ingredientItemId}
                    onChange={(id) => patch(m.key, { ingredientItemId: id })}
                    placeholder={t("pos.setup3.modifier.ingredient.none")}
                  />
                </Field>
                <Field id={`md-qty-${i}`} label={unit ? t("pos.setup3.modifier.quantity.unit", { unit }) : t("pos.setup3.modifier.quantity")}>
                  <Input
                    id={`md-qty-${i}`}
                    type="number"
                    step="any"
                    disabled={!m.ingredientItemId}
                    value={m.ingredientQuantity}
                    onChange={(e) => patch(m.key, { ingredientQuantity: e.target.value })}
                    className="text-right tabular-nums"
                  />
                </Field>
                <label className="flex h-7 items-center gap-1 text-xs">
                  <input type="checkbox" checked={m.isActive} onChange={(e) => patch(m.key, { isActive: e.target.checked })} />
                  {t("common.active")}
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t("pos.setup3.modifier.remove", { name: m.name || String(i + 1) })}
                  onClick={() => setModifiers((all) => all.filter((x) => x.key !== m.key))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setModifiers((all) => [...all, { key: nextKey(), id: undefined, name: "", priceDelta: "0", ingredientItemId: "", ingredientQuantity: "", isActive: true }])}
            >
              <Plus className="size-4" />
              {t("pos.setup3.modifier.add")}
            </Button>
          </div>
          {group && <p className="text-xs text-muted-foreground">{t("pos.setup3.modifier.removeHint")}</p>}
        </fieldset>

        <Field label={t("pos.setup3.group.items")} hint={t("pos.setup3.group.items.hint")}>
          <ItemPicker
            lookup={lookup}
            label={t("pos.setup3.group.items")}
            value=""
            exclude={itemIds}
            onChange={(id) => id && setItemIds((all) => (all.includes(id) ? all : [...all, id]))}
          />
          <ItemChips ids={itemIds} lookup={lookup} onRemove={(id) => setItemIds((all) => all.filter((x) => x !== id))} />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- Per item: production centre and combo ----

interface SlotDraft {
  key: string;
  name: string;
  min: string;
  max: string;
  choices: { key: string; itemId: string; priceDelta: string }[];
}

const slotsFrom = (slots: ComboSlotResponse[]): SlotDraft[] =>
  slots.map((s) => ({
    key: nextKey(), name: s.name, min: String(s.minSelect), max: String(s.maxSelect),
    choices: s.choices.map((c) => ({ key: nextKey(), itemId: c.itemId, priceDelta: String(c.priceDelta) })),
  }));

function Message({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p className={m.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"} role={m.ok ? "status" : "alert"}>{m.text}</p>;
}

function ItemMenuCard({ centers, canEdit }: { centers: ProductionCenterResponse[]; canEdit: boolean }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  // The item being set up is linkable, like a filter.
  const [itemId, setItemId] = useUrlParam("item");
  const lookup = useItemLookup([itemId]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pos.setup3.item.title")}</CardTitle>
        <CardDescription>{t("pos.setup3.item.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="w-full max-w-md">
          <Field label={t("pos.setup3.item.pick")}>
            <ItemPicker lookup={lookup} label={t("pos.setup3.item.pick")} value={itemId} onChange={setItemId} />
          </Field>
        </div>
        {/* Keyed: a different item starts from what the server has. */}
        {itemId && <ItemMenuEditor key={itemId} itemId={itemId} centers={centers} canEdit={canEdit} />}
      </CardContent>
    </Card>
  );
}

function ItemMenuEditor({ itemId, centers, canEdit }: { itemId: string; centers: ProductionCenterResponse[]; canEdit: boolean }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [centerId, setCenterId] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotDraft[] | null>(null);
  const [centerMessage, setCenterMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [comboMessage, setComboMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // The till's menu carries which centre makes each item (ItemResponse does not).
  const menu = useQuery({
    queryKey: menuKey(activeCompanyId),
    queryFn: () => apiClient.getPosMenu(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const combo = useQuery({
    queryKey: ["posCombo", activeCompanyId, itemId],
    queryFn: () => apiClient.getCombo(activeCompanyId as string, itemId),
    enabled: !!activeCompanyId,
  });

  const savedCenter = menu.data?.productionCenters?.[itemId] ?? "";
  const shownCenter = centerId ?? savedCenter;
  const shownSlots = useMemo(() => slots ?? slotsFrom(combo.data ?? []), [slots, combo.data]);
  const lookup = useItemLookup(shownSlots.flatMap((s) => s.choices.map((c) => c.itemId)));

  const saveCenter = useMutation({
    mutationFn: () => apiClient.setItemProductionCenter(activeCompanyId as string, itemId, shownCenter || undefined),
    onSuccess: async () => {
      setCenterId(null);
      setCenterMessage({ ok: true, text: t("pos.setup3.item.center.saved") });
      await queryClient.invalidateQueries({ queryKey: menuKey(activeCompanyId) });
    },
    onError: (err: unknown) => setCenterMessage({ ok: false, text: getApiErrorMessage(err, t("pos.saveError")) }),
  });

  const saveCombo = useMutation({
    mutationFn: () =>
      apiClient.saveCombo(activeCompanyId as string, itemId, {
        slots: shownSlots.map((s) => ({
          name: s.name.trim(),
          minSelect: Number(s.min),
          maxSelect: Number(s.max),
          choices: s.choices.filter((c) => c.itemId).map((c) => ({ itemId: c.itemId, priceDelta: Number(c.priceDelta || 0) })),
        })),
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(["posCombo", activeCompanyId, itemId], result);
      setSlots(null);
      setComboMessage({ ok: true, text: t("pos.setup3.combo.saved") });
      await queryClient.invalidateQueries({ queryKey: menuKey(activeCompanyId) });
    },
    onError: (err: unknown) => setComboMessage({ ok: false, text: getApiErrorMessage(err, t("pos.saveError")) }),
  });

  const edit = (change: (all: SlotDraft[]) => SlotDraft[]) => setSlots(change(shownSlots));
  const patchSlot = (key: string, change: Partial<SlotDraft>) => edit((all) => all.map((s) => (s.key === key ? { ...s, ...change } : s)));
  const patchChoice = (slotKey: string, choiceKey: string, change: Partial<SlotDraft["choices"][number]>) =>
    edit((all) => all.map((s) => (s.key === slotKey ? { ...s, choices: s.choices.map((c) => (c.key === choiceKey ? { ...c, ...change } : c)) } : s)));

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64">
          <Field id="im-center" label={t("pos.setup3.item.center")} hint={t("pos.setup3.item.center.hint")}>
            <Select
              id="im-center"
              value={shownCenter}
              onValueChange={(v) => setCenterId(v)}
              disabled={!canEdit}
              options={[
                { value: "", label: t("pos.setup3.item.center.none") },
                ...centers.filter((c) => c.isActive || c.id === savedCenter).map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </Field>
        </div>
        {canEdit && (
          <Button size="sm" disabled={saveCenter.isPending || shownCenter === savedCenter} onClick={() => saveCenter.mutate()}>
            {t("pos.setup3.item.center.save")}
          </Button>
        )}
      </div>
      <Message m={centerMessage} />

      <fieldset className="flex flex-col gap-3 rounded-md border p-3" disabled={!canEdit}>
        <legend className="px-1 text-sm font-medium">{t("pos.setup3.combo")}</legend>
        <p className="text-xs text-muted-foreground">{t("pos.setup3.combo.hint")}</p>
        {shownSlots.length === 0 && !combo.isPending && <p className="text-sm text-muted-foreground">{t("pos.setup3.combo.empty")}</p>}
        {shownSlots.map((s, si) => (
          <div key={s.key} className="flex flex-col gap-2 rounded-md bg-muted/40 p-2" data-testid="combo-slot">
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]">
              <Field id={`cs-name-${si}`} label={t("pos.setup3.combo.slot.name")}>
                <Input id={`cs-name-${si}`} required maxLength={80} value={s.name} onChange={(e) => patchSlot(s.key, { name: e.target.value })} />
              </Field>
              <Field id={`cs-min-${si}`} label={t("pos.setup3.group.min")}>
                <Input id={`cs-min-${si}`} type="number" min={0} value={s.min} onChange={(e) => patchSlot(s.key, { min: e.target.value })} className="text-right tabular-nums" />
              </Field>
              <Field id={`cs-max-${si}`} label={t("pos.setup3.group.max")}>
                <Input id={`cs-max-${si}`} type="number" min={1} value={s.max} onChange={(e) => patchSlot(s.key, { max: e.target.value })} className="text-right tabular-nums" />
              </Field>
              {canEdit && (
                <Button type="button" size="sm" variant="ghost" aria-label={t("pos.setup3.combo.slot.remove", { name: s.name || String(si + 1) })}
                  onClick={() => edit((all) => all.filter((x) => x.key !== s.key))}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
            {s.choices.map((c, ci) => (
              <div key={c.key} className="grid items-end gap-2 pl-4 sm:grid-cols-[1fr_7rem_auto]">
                <Field label={t("pos.setup3.combo.choice.item")}>
                  <ItemPicker
                    lookup={lookup}
                    label={t("pos.setup3.combo.choice.item")}
                    value={c.itemId}
                    exclude={[itemId]}
                    disabled={!canEdit}
                    onChange={(id) => patchChoice(s.key, c.key, { itemId: id })}
                  />
                </Field>
                <Field id={`cc-price-${si}-${ci}`} label={t("pos.setup3.combo.choice.price")}>
                  <Input id={`cc-price-${si}-${ci}`} type="number" step="0.01" value={c.priceDelta}
                    onChange={(e) => patchChoice(s.key, c.key, { priceDelta: e.target.value })} className="text-right tabular-nums" />
                </Field>
                {canEdit && (
                  <Button type="button" size="sm" variant="ghost" aria-label={t("pos.setup3.combo.choice.remove")}
                    onClick={() => patchSlot(s.key, { choices: s.choices.filter((x) => x.key !== c.key) })}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {canEdit && (
              <div className="pl-4">
                <Button type="button" size="sm" variant="outline"
                  onClick={() => patchSlot(s.key, { choices: [...s.choices, { key: nextKey(), itemId: "", priceDelta: "0" }] })}>
                  <Plus className="size-4" />
                  {t("pos.setup3.combo.choice.add")}
                </Button>
              </div>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline"
              onClick={() => edit((all) => [...all, { key: nextKey(), name: "", min: "1", max: "1", choices: [{ key: nextKey(), itemId: "", priceDelta: "0" }] }])}>
              <Plus className="size-4" />
              {t("pos.setup3.combo.slot.add")}
            </Button>
            <Button type="button" size="sm" disabled={saveCombo.isPending || slots === null} onClick={() => { setComboMessage(null); saveCombo.mutate(); }}>
              {t("pos.setup3.combo.save")}
            </Button>
          </div>
        )}
        <Message m={comboMessage} />
      </fieldset>
    </>
  );
}
