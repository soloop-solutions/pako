import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ProgramResponse, SaveProgramRequest, StoreResponse } from "@pako/shared";
import { Plus, X } from "lucide-react";
import { useIntl, type IntlShape } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosStores } from "@/hooks/usePos";
import { useItemSearch } from "@/hooks/useStock";
import { PROGRAM_KINDS, PROGRAM_REWARD_KINDS, ProgramKind, ProgramRewardKind, programKindKey, programRewardKey } from "@/lib/pos-enums";

const money = (v: number | undefined) => (v ?? 0).toFixed(2);
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const programsKey = (companyId: string | null) => ["posPrograms", companyId] as const;

// What a program gives, as one short line: "10 %", "3 for 5.00", "Buy 2 get 1". Only the
// program's own figures, formatted — nothing is worked out from them.
function rewardSummary(p: ProgramResponse, intl: IntlShape): string {
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const num = (v: number | undefined) => intl.formatNumber(v ?? 0, { maximumFractionDigits: 4 });
  let text: string;
  if (p.kind === ProgramKind.Loyalty) return t("pos.program.summary.loyalty", { points: num(p.pointsPerEuro), value: money(p.pointValue) });
  switch (p.reward) {
    case ProgramRewardKind.PercentOff:
      text = t("pos.program.summary.percent", { percent: num(p.percent) });
      break;
    case ProgramRewardKind.AmountOff:
      text = t("pos.program.summary.amount", { amount: money(p.amount) });
      break;
    case ProgramRewardKind.FixedPrice:
      text = t("pos.program.summary.price", { price: money(p.price) });
      break;
    case ProgramRewardKind.BuyXGetY:
      text = t("pos.program.summary.buyGet", { buy: p.buyQuantity ?? 0, get: p.getQuantity ?? 0 });
      break;
    case ProgramRewardKind.MultiBuy:
      text = t("pos.program.summary.multiBuy", { buy: p.buyQuantity ?? 0, price: money(p.price) });
      break;
    default:
      text = p.percent != null
        ? t("pos.program.summary.basketPercent", { percent: num(p.percent) })
        : t("pos.program.summary.basketAmount", { amount: money(p.amount) });
  }
  const conditions = [
    p.minAmount != null ? t("pos.program.summary.minAmount", { amount: money(p.minAmount) }) : null,
    p.minQuantity != null ? t("pos.program.summary.minQuantity", { quantity: num(p.minQuantity) }) : null,
  ].filter(Boolean);
  return conditions.length ? `${text} · ${conditions.join(" · ")}` : text;
}

// Days are a bitmask: Monday = bit 0 … Sunday = bit 6; 0 = every day.
const daysFromMask = (mask: number) => DAYS.filter((d) => (mask & (1 << d)) !== 0);
const maskFromDays = (days: number[]) => days.reduce((mask, d) => mask | (1 << d), 0);

// "HH:mm:ss" from the API → "HH:mm" for display and the time input; back with seconds.
const hhmm = (v: string | undefined) => (v ? v.slice(0, 5) : "");

function whenSummary(p: ProgramResponse, intl: IntlShape): string {
  const t = (id: string) => intl.formatMessage({ id });
  const parts: string[] = [];
  if (p.validFrom || p.validTo)
    parts.push(`${p.validFrom ? intl.formatDate(p.validFrom) : "…"} – ${p.validTo ? intl.formatDate(p.validTo) : "…"}`);
  if (p.days !== 0) parts.push(daysFromMask(p.days).map((d) => t(`pos.program.day.${d}`)).join(" "));
  if (p.timeFrom && p.timeTo) parts.push(`${hhmm(p.timeFrom)}–${hhmm(p.timeTo)}`);
  return parts.length ? parts.join(" · ") : t("pos.program.always");
}

// docs/POS_PLAN.md §12.6 / P2: promotions, coupons and the loyalty program. Pos: Read sees them,
// Pos: Approve sets them up. The tills price them on the server.
export function PosPrograms() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const stores = usePosStores().data ?? [];
  const canEdit = canApprove("pos");
  const [editing, setEditing] = useState<ProgramResponse | "new" | null>(null);
  const programs = useQuery({
    queryKey: programsKey(activeCompanyId),
    queryFn: () => apiClient.listPosPrograms(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });

  const columns = useMemo<ColumnDef<ProgramResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("pos.program.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { id: "kind", header: t("pos.program.kind"), cell: ({ row }) => t(`pos.program.kind.${programKindKey(row.original.kind)}`) },
      { id: "reward", header: t("pos.program.reward"), cell: ({ row }) => <span className="tabular-nums">{rewardSummary(row.original, intl)}</span> },
      { id: "when", header: t("pos.program.when"), cell: ({ row }) => whenSummary(row.original, intl) },
      {
        id: "store",
        header: t("pos.program.store"),
        cell: ({ row }) => (row.original.storeId ? stores.find((s) => s.id === row.original.storeId)?.name ?? "—" : t("pos.program.store.all")),
      },
      { id: "code", header: t("pos.program.code"), cell: ({ row }) => row.original.code ?? "—" },
      {
        id: "uses",
        header: t("pos.program.uses"),
        meta: { numeric: true },
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {row.original.uses}
            {row.original.maxUses != null && ` / ${row.original.maxUses}`}
          </span>
        ),
      },
      { accessorKey: "priority", header: t("pos.program.priority"), meta: { numeric: true } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, stores],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const rows = programs.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("nav.posPrograms")}</CardTitle>
            <CardDescription>{t("nav.posPrograms.description")}</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("pos.program.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-programs"
            columns={columns}
            data={rows}
            rowCount={rows.length}
            isLoading={programs.isPending}
            getRowId={(p) => p.id}
            getRowClassName={(p) => (p.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canEdit ? setEditing : undefined}
            emptyMessage={t("pos.program.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
      {editing && (
        <ProgramDialog
          program={editing === "new" ? null : editing}
          stores={stores}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: programsKey(activeCompanyId) });
          }}
        />
      )}
    </div>
  );
}

function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const str = (v: number | undefined | null) => (v == null ? "" : String(v));
// An empty box is "not set" (null on the wire), never zero.
const optNumber = (v: string) => (v.trim() === "" ? undefined : Number(v));

function ProgramDialog({ program, stores, onClose, onSaved }: {
  program: ProgramResponse | null;
  stores: StoreResponse[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const [name, setName] = useState(program?.name ?? "");
  const [kind, setKind] = useState(String(program?.kind ?? ProgramKind.Promotion));
  const [reward, setReward] = useState(String(program?.reward ?? ProgramRewardKind.PercentOff));
  const [percent, setPercent] = useState(str(program?.percent));
  const [amount, setAmount] = useState(str(program?.amount));
  const [price, setPrice] = useState(str(program?.price));
  const [buy, setBuy] = useState(str(program?.buyQuantity));
  const [get, setGet] = useState(str(program?.getQuantity));
  const [pointsPerEuro, setPointsPerEuro] = useState(str(program?.pointsPerEuro));
  const [pointValue, setPointValue] = useState(str(program?.pointValue));
  const [minQuantity, setMinQuantity] = useState(str(program?.minQuantity));
  const [minAmount, setMinAmount] = useState(str(program?.minAmount));
  const [validFrom, setValidFrom] = useState(program?.validFrom ?? "");
  const [validTo, setValidTo] = useState(program?.validTo ?? "");
  const [days, setDays] = useState<number[]>(daysFromMask(program?.days ?? 0));
  const [timeFrom, setTimeFrom] = useState(hhmm(program?.timeFrom));
  const [timeTo, setTimeTo] = useState(hhmm(program?.timeTo));
  const [storeId, setStoreId] = useState(program?.storeId ?? "");
  const [priority, setPriority] = useState(String(program?.priority ?? 100));
  const [stackable, setStackable] = useState(program?.stackable ?? false);
  const [code, setCode] = useState(program?.code ?? "");
  const [maxUses, setMaxUses] = useState(str(program?.maxUses));
  const [itemIds, setItemIds] = useState<string[]>(program?.itemIds ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(program?.categoryIds ?? []);
  const [isActive, setIsActive] = useState(program?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const itemSearch = useItemSearch();
  const categories = useQuery({
    queryKey: ["itemCategories", companyId],
    queryFn: () => apiClient.listItemCategories(companyId),
    enabled: !!companyId,
  }).data ?? [];
  // The names of items already targeted that no search has shown yet.
  const knownIds = new Set(itemSearch.items.map((i) => i.id));
  const missing = itemIds.filter((id) => !knownIds.has(id)).sort();
  const fetched = useQuery({
    queryKey: ["items", companyId, "byIds", missing.join(",")],
    queryFn: async () => Promise.all(missing.map((id) => apiClient.itemsGET2(companyId, id))),
    enabled: missing.length > 0,
    staleTime: 60_000,
  }).data ?? [];
  const itemName = (id: string) =>
    itemSearch.items.find((i) => i.id === id)?.name ?? fetched.find((i) => i.id === id)?.name ?? "…";

  const k = Number(kind);
  const r = Number(reward);
  const loyalty = k === ProgramKind.Loyalty;
  const uses = { percent: false, amount: false, price: false, buy: false, get: false };
  if (!loyalty) {
    uses.percent = r === ProgramRewardKind.PercentOff || r === ProgramRewardKind.BasketDiscount;
    uses.amount = r === ProgramRewardKind.AmountOff || r === ProgramRewardKind.BasketDiscount;
    uses.price = r === ProgramRewardKind.FixedPrice || r === ProgramRewardKind.MultiBuy;
    uses.buy = r === ProgramRewardKind.BuyXGetY || r === ProgramRewardKind.MultiBuy;
    uses.get = r === ProgramRewardKind.BuyXGetY;
  }

  const save = useMutation({
    mutationFn: () => {
      const body: SaveProgramRequest = {
        name: name.trim(),
        kind: k,
        reward: loyalty ? ProgramRewardKind.BasketDiscount : r,
        isActive,
        validFrom: validFrom || undefined,
        validTo: validTo || undefined,
        days: maskFromDays(days),
        timeFrom: timeFrom ? `${timeFrom}:00` : undefined,
        timeTo: timeTo ? `${timeTo}:00` : undefined,
        storeId: storeId || undefined,
        priority: Number(priority),
        stackable,
        code: code.trim() || undefined,
        maxUses: optNumber(maxUses),
        minQuantity: optNumber(minQuantity),
        minAmount: optNumber(minAmount),
        percent: uses.percent ? optNumber(percent) : undefined,
        amount: uses.amount ? optNumber(amount) : undefined,
        price: uses.price ? optNumber(price) : undefined,
        buyQuantity: uses.buy ? optNumber(buy) : undefined,
        getQuantity: uses.get ? optNumber(get) : undefined,
        pointsPerEuro: loyalty ? optNumber(pointsPerEuro) : undefined,
        pointValue: loyalty ? optNumber(pointValue) : undefined,
        itemIds,
        categoryIds,
      };
      return program ? apiClient.updatePosProgram(companyId, program.id, body) : apiClient.createPosProgram(companyId, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const numberInput = (id: string, value: string, onChange: (v: string) => void, props: { step?: string; min?: number; max?: number; required?: boolean } = {}) => (
    <Input id={id} type="number" step={props.step ?? "0.01"} min={props.min ?? 0} max={props.max} required={props.required} value={value}
      onChange={(e) => onChange(e.target.value)} className="text-right tabular-nums" />
  );

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={program ? program.name : t("pos.program.new")} size="lg">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field id="pg-name" label={t("pos.program.name")}>
            <Input id="pg-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="pg-kind" label={t("pos.program.kind")}>
            <Select
              id="pg-kind"
              value={kind}
              onValueChange={setKind}
              options={PROGRAM_KINDS.map((x) => ({ value: String(x), label: t(`pos.program.kind.${programKindKey(x)}`) }))}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t("pos.program.kind.hint")}</p>

        {loyalty ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pg-ppe" label={t("pos.program.pointsPerEuro")}>
              {numberInput("pg-ppe", pointsPerEuro, setPointsPerEuro, { step: "any", required: true })}
            </Field>
            <Field id="pg-pv" label={t("pos.program.pointValue")}>
              {numberInput("pg-pv", pointValue, setPointValue, { step: "any", required: true })}
            </Field>
          </div>
        ) : (
          <>
            <Field id="pg-reward" label={t("pos.program.reward")}>
              <Select
                id="pg-reward"
                value={reward}
                onValueChange={setReward}
                options={PROGRAM_REWARD_KINDS.map((x) => ({ value: String(x), label: t(`pos.program.reward.${programRewardKey(x)}`) }))}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              {uses.buy && (
                <Field id="pg-buy" label={t(r === ProgramRewardKind.MultiBuy ? "pos.program.multiBuyQuantity" : "pos.program.buyQuantity")}>
                  {numberInput("pg-buy", buy, setBuy, { step: "1", min: 1, required: true })}
                </Field>
              )}
              {uses.get && (
                <Field id="pg-get" label={t("pos.program.getQuantity")}>
                  {numberInput("pg-get", get, setGet, { step: "1", min: 1, required: true })}
                </Field>
              )}
              {uses.percent && (
                <Field id="pg-percent" label={t("pos.program.percent")}>
                  {numberInput("pg-percent", percent, setPercent, { max: 100, required: r !== ProgramRewardKind.BasketDiscount })}
                </Field>
              )}
              {uses.amount && (
                <Field id="pg-amount" label={t("pos.program.amount")}>
                  {numberInput("pg-amount", amount, setAmount, { required: r !== ProgramRewardKind.BasketDiscount })}
                </Field>
              )}
              {uses.price && (
                <Field id="pg-price" label={t("pos.program.price")}>
                  {numberInput("pg-price", price, setPrice, { required: true })}
                </Field>
              )}
            </div>
            {r === ProgramRewardKind.BasketDiscount && <p className="text-xs text-muted-foreground">{t("pos.program.basket.hint")}</p>}
          </>
        )}

        <fieldset className="flex flex-col gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{t("pos.program.conditions")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pg-minqty" label={t("pos.program.minQuantity")}>
              {numberInput("pg-minqty", minQuantity, setMinQuantity, { step: "any" })}
            </Field>
            <Field id="pg-minamt" label={t("pos.program.minAmount")}>
              {numberInput("pg-minamt", minAmount, setMinAmount)}
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{t("pos.program.when")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pg-from" label={t("pos.program.validFrom")}>
              <Input id="pg-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Field id="pg-to" label={t("pos.program.validTo")}>
              <Input id="pg-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("pos.program.days")}</span>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((d) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={days.includes(d)}
                    onChange={(e) => setDays((all) => (e.target.checked ? [...all, d] : all.filter((x) => x !== d)))}
                  />
                  {t(`pos.program.day.${d}`)}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("pos.program.days.hint")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pg-tfrom" label={t("pos.program.timeFrom")}>
              <Input id="pg-tfrom" type="time" value={timeFrom} required={!!timeTo} onChange={(e) => setTimeFrom(e.target.value)} />
            </Field>
            <Field id="pg-tto" label={t("pos.program.timeTo")}>
              <Input id="pg-tto" type="time" value={timeTo} required={!!timeFrom} onChange={(e) => setTimeTo(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">{t("pos.program.time.hint")}</p>
          <Field id="pg-store" label={t("pos.program.store")}>
            <Select
              id="pg-store"
              value={storeId}
              onValueChange={setStoreId}
              options={[{ value: "", label: t("pos.program.store.all") }, ...stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))]}
            />
          </Field>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="pg-code" label={t("pos.program.code")}>
            <Input id="pg-code" maxLength={40} required={k === ProgramKind.Coupon} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field id="pg-max" label={t("pos.program.maxUses")}>
            {numberInput("pg-max", maxUses, setMaxUses, { step: "1", min: 1 })}
          </Field>
          <Field id="pg-priority" label={t("pos.program.priority")} hint={t("pos.program.priority.hint")}>
            {numberInput("pg-priority", priority, setPriority, { step: "1", required: true })}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={stackable} onChange={(e) => setStackable(e.target.checked)} />
          {t("pos.program.stackable")}
          <span className="text-xs text-muted-foreground">— {t("pos.program.stackable.hint")}</span>
        </label>

        {!loyalty && (
          <fieldset className="flex flex-col gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t("pos.program.targets")}</legend>
            <p className="text-xs text-muted-foreground">{t("pos.program.targets.hint")}</p>
            <Field label={t("pos.program.targets.items")}>
              <SearchableSelect
                value=""
                aria-label={t("pos.program.targets.items")}
                onChange={(id) => id && setItemIds((all) => (all.includes(id) ? all : [...all, id]))}
                placeholder={t("pos.program.targets.pickItem")}
                searchPlaceholder={t("common.search")}
                noResultsText={t("common.noResults")}
                onSearchChange={itemSearch.onSearchChange}
                options={itemSearch.items.filter((i) => !itemIds.includes(i.id)).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }))}
              />
              <Chips ids={itemIds} label={itemName} onRemove={(id) => setItemIds((all) => all.filter((x) => x !== id))} />
            </Field>
            <Field label={t("pos.program.targets.categories")}>
              <SearchableSelect
                value=""
                aria-label={t("pos.program.targets.categories")}
                onChange={(id) => id && setCategoryIds((all) => (all.includes(id) ? all : [...all, id]))}
                placeholder={t("pos.program.targets.pickCategory")}
                searchPlaceholder={t("common.search")}
                noResultsText={t("common.noResults")}
                options={categories.filter((c) => !categoryIds.includes(c.id)).map((c) => ({ value: c.id, label: c.name }))}
              />
              <Chips
                ids={categoryIds}
                label={(id) => categories.find((c) => c.id === id)?.name ?? "…"}
                onRemove={(id) => setCategoryIds((all) => all.filter((x) => x !== id))}
              />
            </Field>
          </fieldset>
        )}

        {program && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("common.active")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function Chips({ ids, label, onRemove }: { ids: string[]; label: (id: string) => string; onRemove: (id: string) => void }) {
  const intl = useIntl();
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} variant="secondary" className="gap-1">
          {label(id)}
          <button
            type="button"
            aria-label={intl.formatMessage({ id: "pos.program.targets.remove" }, { name: label(id) })}
            onClick={() => onRemove(id)}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
