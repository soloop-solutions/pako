import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  FleetCardResponse, ForecourtGradeRow, ForecourtNozzleRow, ForecourtReconciliationResponse, NozzleResponse, TankResponse,
} from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useItemSearch } from "@/hooks/useStock";
import { useUrlParam } from "@/hooks/useUrlParam";
import { todayLocal } from "@/lib/pos-services";
import { cn } from "@/lib/utils";
import { ErrorAlert } from "@/pages/pos/hotel/hotel-shared";
import { isIsoDate } from "@/pages/pos/hotel/hotel-utils";
import { Field, StoreSelect, TabBar } from "@/pages/pos/specialist/shared";
import { money, parseDecimal, qty, usePartners, useStoreParam } from "@/pages/pos/specialist/specialist-utils";

type Tab = "readings" | "dips" | "reconciliation" | "setup" | "fleet";
const TABS: Tab[] = ["readings", "dips", "reconciliation", "setup", "fleet"];

const tanksKey = (companyId: string | null, storeId: string) => ["posTanks", companyId, storeId] as const;
const nozzlesKey = (companyId: string | null, storeId: string) => ["posNozzles", companyId, storeId] as const;

function useTanks(storeId: string) {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: tanksKey(activeCompanyId, storeId),
    queryFn: () => apiClient.listPosFuelTanks(activeCompanyId as string, storeId),
    enabled: !!activeCompanyId && !!storeId,
  });
}

function useNozzles(storeId: string) {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: nozzlesKey(activeCompanyId, storeId),
    queryFn: () => apiClient.listPosFuelNozzles(activeCompanyId as string, storeId),
    enabled: !!activeCompanyId && !!storeId,
  });
}

/** A difference the server worked out: zero is quiet, anything else is flagged. */
function Difference({ value }: { value: number | undefined | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("tabular-nums", value !== 0 && "font-semibold text-destructive")}>{qty(value)}</span>;
}

// docs/POS_PLAN.md §6.8 / P7: the fuel station back office — the shift's meter readings, tank dips,
// the day's reconciliation (litres pumped against litres sold, book stock against the dips), the
// tanks and nozzles, and fleet cards. Litres and differences are the server's.
export function Forecourt() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [tabParam, setTab] = useUrlParam("tab", "readings");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "readings";
  const [storeId, setStoreId] = useStoreParam();
  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <TabBar label={t("spec.nav.forecourt")} value={tab} onChange={setTab} tabs={TABS.map((id) => ({ id, label: t(`spec.fuel.tab.${id}`) }))} />
      {tab !== "fleet" && <StoreSelect value={storeId} onChange={setStoreId} />}
      {tab === "readings" && storeId && <ReadingsTab storeId={storeId} />}
      {tab === "dips" && storeId && <DipsTab storeId={storeId} />}
      {tab === "reconciliation" && storeId && <ReconciliationTab storeId={storeId} />}
      {tab === "setup" && storeId && <SetupTab storeId={storeId} />}
      {tab === "fleet" && <FleetCardsTab />}
    </div>
  );
}

// ---- Shift readings ----

interface ReadingDraft {
  opening: string;
  closing: string;
}

function ReadingsTab({ storeId }: { storeId: string }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const nozzles = useNozzles(storeId);
  const [date, setDate] = useUrlParam("date", todayLocal());
  const [drafts, setDrafts] = useState<Record<string, ReadingDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForecourtReconciliationResponse | null>(null);
  const rows = useMemo(() => (nozzles.data ?? []).filter((n) => n.isActive).sort((a, b) => a.pump - b.pump || a.number - b.number), [nozzles.data]);
  // The opening reading is the last closing on the nozzle (the server refuses a gap); typed over only
  // for a nozzle never read before.
  const draftOf = (n: NozzleResponse): ReadingDraft => drafts[n.id] ?? { opening: n.lastClosing != null ? String(n.lastClosing) : "", closing: "" };
  const setDraft = (id: string, patch: Partial<ReadingDraft>, n: NozzleResponse) => setDrafts((d) => ({ ...d, [id]: { ...draftOf(n), ...patch } }));

  const save = useMutation({
    mutationFn: (readings: { nozzleId: string; opening: number; closing: number }[]) =>
      apiClient.savePosMeterReadings(activeCompanyId as string, { storeId, date, readings }),
    onSuccess: async (rec) => {
      setResult(rec);
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: nozzlesKey(activeCompanyId, storeId) });
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const readings: { nozzleId: string; opening: number; closing: number }[] = [];
    for (const n of rows) {
      const d = draftOf(n);
      if (!d.closing.trim()) continue;
      const opening = parseDecimal(d.opening, 3);
      const closing = parseDecimal(d.closing, 3);
      if (opening == null || closing == null || closing < opening) {
        setError(t("spec.fuel.readings.invalid", { pump: n.pump, number: n.number }));
        return;
      }
      readings.push({ nozzleId: n.id, opening, closing });
    }
    if (readings.length === 0) {
      setError(t("spec.fuel.readings.none"));
      return;
    }
    save.mutate(readings);
  }

  // Excel keys: Enter commits and moves down to the next nozzle's closing reading.
  function moveDown(e: KeyboardEvent<HTMLInputElement>, index: number, field: "opening" | "closing") {
    if (e.key !== "Enter" || index >= rows.length - 1) return;
    e.preventDefault();
    document.querySelector<HTMLInputElement>(`[data-reading="${index + 1}-${field}"]`)?.focus();
  }

  const columns: ColumnDef<NozzleResponse>[] = [
    { id: "pump", header: t("spec.fuel.pump"), accessorFn: (n) => n.pump, meta: { numeric: true } },
    { id: "nozzle", header: t("spec.fuel.nozzle"), accessorFn: (n) => n.number, meta: { numeric: true } },
    { accessorKey: "itemName", header: t("spec.fuel.grade") },
    { accessorKey: "tankName", header: t("spec.fuel.tank") },
    {
      id: "opening",
      header: t("spec.fuel.opening"),
      meta: { numeric: true },
      cell: ({ row }) => (
        <Input
          aria-label={t("spec.fuel.openingOf", { pump: row.original.pump, number: row.original.number })}
          data-reading={`${row.index}-opening`}
          inputMode="decimal"
          value={draftOf(row.original).opening}
          onChange={(e) => setDraft(row.original.id, { opening: e.target.value }, row.original)}
          onKeyDown={(e) => moveDown(e, row.index, "opening")}
          className="h-7 w-32 text-right tabular-nums"
        />
      ),
    },
    {
      id: "closing",
      header: t("spec.fuel.closing"),
      meta: { numeric: true },
      cell: ({ row }) => (
        <Input
          aria-label={t("spec.fuel.closingOf", { pump: row.original.pump, number: row.original.number })}
          data-reading={`${row.index}-closing`}
          inputMode="decimal"
          value={draftOf(row.original).closing}
          onChange={(e) => setDraft(row.original.id, { closing: e.target.value }, row.original)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(row.original.id, { closing: "" }, row.original);
            moveDown(e, row.index, "closing");
          }}
          className="h-7 w-32 text-right tabular-nums"
        />
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("spec.fuel.tab.readings")}</CardTitle>
        <CardDescription>{t("spec.fuel.readings.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Field id="readings-date" label={t("common.date")} className="w-44">
            <Input id="readings-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <ErrorAlert message={error} />
          <DataGrid
            gridId="pos-meter-readings"
            columns={columns}
            data={rows}
            rowCount={rows.length}
            isLoading={nozzles.isPending}
            getRowId={(n) => n.id}
            emptyMessage={t("spec.fuel.nozzles.empty")}
          />
          {canWrite("pos") && (
            <Button type="submit" className="self-end" disabled={save.isPending || rows.length === 0 || !isIsoDate(date)}>
              {t("spec.fuel.readings.save")}
            </Button>
          )}
        </form>
        {result && (
          <div className="mt-4 flex flex-col gap-2" data-testid="readings-result">
            <h3 className="text-sm font-semibold">{t("spec.fuel.readings.result")}</h3>
            <NozzleReconciliationGrid rows={result.nozzles} gridId="pos-readings-result" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Dips ----

function DipsTab({ storeId }: { storeId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { canWrite } = useMyAccess();
  const tanks = useTanks(storeId);
  const [dipping, setDipping] = useState<TankResponse | null>(null);
  const rows = (tanks.data ?? []).filter((x) => x.isActive);
  const columns = useMemo<ColumnDef<TankResponse>[]>(
    () => [
      { accessorKey: "name", header: t("spec.fuel.tank") },
      { accessorKey: "itemName", header: t("spec.fuel.grade") },
      { accessorKey: "capacity", header: t("spec.fuel.capacity"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { id: "lastDip", header: t("spec.fuel.lastDip"), meta: { numeric: true }, accessorFn: (x) => x.lastDip, cell: ({ row }) => qty(row.original.lastDip) },
      { id: "lastDipAt", header: t("spec.fuel.lastDipAt"), accessorFn: (x) => (x.lastDipAt ? intl.formatDate(x.lastDipAt, { dateStyle: "short", timeStyle: "short" }) : "—") },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          canWrite("pos") ? (
            <Button size="xs" variant="outline" onClick={() => setDipping(row.original)}>{t("spec.fuel.dip.record")}</Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("spec.fuel.tab.dips")}</CardTitle>
        <CardDescription>{t("spec.fuel.dips.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <DataGrid gridId="pos-tank-dips" columns={columns} data={rows} rowCount={rows.length} isLoading={tanks.isPending} getRowId={(x) => x.id} emptyMessage={t("spec.fuel.tanks.empty")} />
      </CardContent>
      {dipping && <DipDialog tank={dipping} storeId={storeId} onClose={() => setDipping(null)} />}
    </Card>
  );
}

function DipDialog({ tank, storeId, onClose }: { tank: TankResponse; storeId: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [volume, setVolume] = useState("");
  const [water, setWater] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { volume: number; water: number }) => apiClient.addPosTankDip(activeCompanyId as string, { tankId: tank.id, ...body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tanksKey(activeCompanyId, storeId) });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = parseDecimal(volume, 3);
    const w = water.trim() === "" ? 0 : parseDecimal(water, 3);
    if (v == null || w == null) {
      setError(t("spec.fuel.dip.invalid"));
      return;
    }
    save.mutate({ volume: v, water: w });
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={t("spec.fuel.dip.title", { tank: tank.name, grade: tank.itemName })} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert message={error} />
        <Field id="dip-volume" label={t("spec.fuel.dip.volume")} hint={t("spec.fuel.dip.capacity", { capacity: qty(tank.capacity) })}>
          <Input id="dip-volume" inputMode="decimal" autoFocus required value={volume} onChange={(e) => setVolume(e.target.value)} className="text-right tabular-nums" />
        </Field>
        <Field id="dip-water" label={t("spec.fuel.dip.water")}>
          <Input id="dip-water" inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} className="text-right tabular-nums" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !volume.trim()}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- Reconciliation ----

function NozzleReconciliationGrid({ rows, gridId }: { rows: ForecourtNozzleRow[]; gridId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const columns = useMemo<ColumnDef<ForecourtNozzleRow>[]>(
    () => [
      { accessorKey: "pump", header: t("spec.fuel.pump"), meta: { numeric: true } },
      { accessorKey: "number", header: t("spec.fuel.nozzle"), meta: { numeric: true } },
      { accessorKey: "itemName", header: t("spec.fuel.grade") },
      { accessorKey: "pumped", header: t("spec.fuel.pumped"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { accessorKey: "sold", header: t("spec.fuel.sold"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { accessorKey: "difference", header: t("spec.fuel.difference"), meta: { numeric: true }, cell: ({ getValue }) => <Difference value={getValue() as number} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  return <DataGrid gridId={gridId} columns={columns} data={rows} rowCount={rows.length} getRowId={(r) => r.nozzleId} emptyMessage={t("spec.fuel.nozzles.empty")} />;
}

function ReconciliationTab({ storeId }: { storeId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [date, setDate] = useUrlParam("date", todayLocal());
  const rec = useQuery({
    queryKey: ["posForecourtRec", activeCompanyId, storeId, date],
    queryFn: () => apiClient.getPosForecourtReconciliation(activeCompanyId as string, storeId, date),
    enabled: !!activeCompanyId && !!storeId && isIsoDate(date),
    placeholderData: keepPreviousData,
  });
  const gradeColumns = useMemo<ColumnDef<ForecourtGradeRow>[]>(
    () => [
      { accessorKey: "itemName", header: t("spec.fuel.grade") },
      { accessorKey: "pumped", header: t("spec.fuel.pumped"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { accessorKey: "sold", header: t("spec.fuel.sold"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { accessorKey: "difference", header: t("spec.fuel.difference"), meta: { numeric: true }, cell: ({ getValue }) => <Difference value={getValue() as number} /> },
      { accessorKey: "bookStock", header: t("spec.fuel.bookStock"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { id: "dipped", header: t("spec.fuel.dipped"), meta: { numeric: true }, accessorFn: (r) => r.dipped, cell: ({ row }) => qty(row.original.dipped) },
      { id: "dipDifference", header: t("spec.fuel.dipDifference"), meta: { numeric: true }, accessorFn: (r) => r.dipDifference, cell: ({ row }) => <Difference value={row.original.dipDifference} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const grades = rec.data?.grades ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("spec.fuel.tab.reconciliation")}</CardTitle>
        <CardDescription>{t("spec.fuel.rec.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field id="rec-date" label={t("common.date")} className="w-44">
          <Input id="rec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ErrorAlert message={rec.error ? getApiErrorMessage(rec.error, t("spec.loadError")) : null} />
        <h3 className="text-sm font-semibold">{t("spec.fuel.rec.byNozzle")}</h3>
        <NozzleReconciliationGrid rows={rec.data?.nozzles ?? []} gridId="pos-fuel-rec-nozzles" />
        <h3 className="text-sm font-semibold">{t("spec.fuel.rec.byGrade")}</h3>
        <DataGrid gridId="pos-fuel-rec-grades" columns={gradeColumns} data={grades} rowCount={grades.length} isLoading={rec.isPending} getRowId={(r) => r.itemId} emptyMessage={t("spec.fuel.tanks.empty")} />
      </CardContent>
    </Card>
  );
}

// ---- Setup: tanks and nozzles ----

function SetupTab({ storeId }: { storeId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { canApprove } = useMyAccess();
  const tanks = useTanks(storeId);
  const nozzles = useNozzles(storeId);
  const [tankOpen, setTankOpen] = useState<TankResponse | "new" | null>(null);
  const [nozzleOpen, setNozzleOpen] = useState<NozzleResponse | "new" | null>(null);
  const tankColumns = useMemo<ColumnDef<TankResponse>[]>(
    () => [
      { accessorKey: "name", header: t("spec.fuel.tank") },
      { accessorKey: "itemName", header: t("spec.fuel.grade") },
      { accessorKey: "capacity", header: t("spec.fuel.capacity"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { id: "active", header: t("spec.status"), accessorFn: (x) => t(x.isActive ? "common.active" : "common.inactive") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const nozzleColumns = useMemo<ColumnDef<NozzleResponse>[]>(
    () => [
      { accessorKey: "pump", header: t("spec.fuel.pump"), meta: { numeric: true } },
      { accessorKey: "number", header: t("spec.fuel.nozzle"), meta: { numeric: true } },
      { accessorKey: "tankName", header: t("spec.fuel.tank") },
      { accessorKey: "itemName", header: t("spec.fuel.grade") },
      { id: "lastClosing", header: t("spec.fuel.lastClosing"), meta: { numeric: true }, accessorFn: (n) => n.lastClosing, cell: ({ row }) => qty(row.original.lastClosing) },
      { id: "active", header: t("spec.status"), accessorFn: (x) => t(x.isActive ? "common.active" : "common.inactive") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const tankRows = tanks.data ?? [];
  const nozzleRows = nozzles.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {!canApprove("pos") && <p className="text-sm text-muted-foreground">{t("spec.approveOnly")}</p>}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("spec.fuel.tanks")}</CardTitle>
            <CardDescription>{t("spec.fuel.tanks.description")}</CardDescription>
          </div>
          {canApprove("pos") && (
            <Button size="sm" onClick={() => setTankOpen("new")}>
              <Plus className="size-4" /> {t("spec.fuel.tank.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-fuel-tanks"
            columns={tankColumns}
            data={tankRows}
            rowCount={tankRows.length}
            isLoading={tanks.isPending}
            getRowId={(x) => x.id}
            getRowClassName={(x) => (x.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canApprove("pos") ? setTankOpen : undefined}
            emptyMessage={t("spec.fuel.tanks.empty")}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("spec.fuel.nozzles")}</CardTitle>
            <CardDescription>{t("spec.fuel.nozzles.description")}</CardDescription>
          </div>
          {canApprove("pos") && (
            <Button size="sm" disabled={tankRows.length === 0} onClick={() => setNozzleOpen("new")}>
              <Plus className="size-4" /> {t("spec.fuel.nozzle.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-fuel-nozzles"
            columns={nozzleColumns}
            data={nozzleRows}
            rowCount={nozzleRows.length}
            isLoading={nozzles.isPending}
            getRowId={(x) => x.id}
            getRowClassName={(x) => (x.isActive ? undefined : "text-muted-foreground")}
            onRowClick={canApprove("pos") ? setNozzleOpen : undefined}
            emptyMessage={t("spec.fuel.nozzles.empty")}
          />
        </CardContent>
      </Card>
      {tankOpen && <TankDialog storeId={storeId} tank={tankOpen === "new" ? null : tankOpen} onClose={() => setTankOpen(null)} />}
      {nozzleOpen && <NozzleDialog storeId={storeId} tanks={tankRows} nozzle={nozzleOpen === "new" ? null : nozzleOpen} onClose={() => setNozzleOpen(null)} />}
    </div>
  );
}

function TankDialog({ storeId, tank, onClose }: { storeId: string; tank: TankResponse | null; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const itemSearch = useItemSearch({ trackedOnly: true });
  const [name, setName] = useState(tank?.name ?? "");
  const [itemId, setItemId] = useState(tank?.itemId ?? "");
  const [capacity, setCapacity] = useState(tank ? String(tank.capacity) : "");
  const [isActive, setIsActive] = useState(tank?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => {
    const list = itemSearch.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
    if (tank && !list.some((o) => o.value === tank.itemId)) list.unshift({ value: tank.itemId, label: tank.itemName });
    return list;
  }, [itemSearch.items, tank]);
  const save = useMutation({
    mutationFn: (cap: number) => {
      const body = { storeId, name: name.trim(), itemId, capacity: cap, isActive };
      return tank ? apiClient.updatePosFuelTank(activeCompanyId as string, tank.id, body) : apiClient.createPosFuelTank(activeCompanyId as string, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tanksKey(activeCompanyId, storeId) });
      await queryClient.invalidateQueries({ queryKey: nozzlesKey(activeCompanyId, storeId) });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cap = parseDecimal(capacity, 3);
    if (cap == null || !(cap > 0)) {
      setError(t("spec.fuel.capacity.invalid"));
      return;
    }
    save.mutate(cap);
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={tank ? tank.name : t("spec.fuel.tank.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert message={error} />
        <Field id="tank-name" label={t("common.name")}>
          <Input id="tank-name" required maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="tank-item" label={t("spec.fuel.grade")} hint={t("spec.fuel.grade.hint")}>
          <SearchableSelect
            id="tank-item"
            value={itemId}
            onChange={setItemId}
            onSearchChange={itemSearch.onSearchChange}
            placeholder={t("spec.fuel.grade.pick")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("common.noResults")}
            options={options}
          />
        </Field>
        <Field id="tank-capacity" label={t("spec.fuel.capacity")}>
          <Input id="tank-capacity" inputMode="decimal" required value={capacity} onChange={(e) => setCapacity(e.target.value)} className="text-right tabular-nums" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !name.trim() || !itemId}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function NozzleDialog({ storeId, tanks, nozzle, onClose }: { storeId: string; tanks: TankResponse[]; nozzle: NozzleResponse | null; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [pump, setPump] = useState(nozzle ? String(nozzle.pump) : "1");
  const [number, setNumber] = useState(nozzle ? String(nozzle.number) : "1");
  const [tankId, setTankId] = useState(nozzle?.tankId ?? tanks.find((x) => x.isActive)?.id ?? "");
  const [isActive, setIsActive] = useState(nozzle?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { storeId, pump: Number(pump), number: Number(number), tankId, isActive };
      return nozzle ? apiClient.updatePosFuelNozzle(activeCompanyId as string, nozzle.id, body) : apiClient.createPosFuelNozzle(activeCompanyId as string, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: nozzlesKey(activeCompanyId, storeId) });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const pumpOk = /^\d{1,2}$/.test(pump) && Number(pump) >= 1;
  const numberOk = /^[1-9]$/.test(number);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={nozzle ? t("spec.fuel.nozzleShort", { pump: nozzle.pump, number: nozzle.number }) : t("spec.fuel.nozzle.new")}
      size="sm"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <ErrorAlert message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field id="nozzle-pump" label={t("spec.fuel.pump")} hint={t("spec.fuel.pump.hint")}>
            <Input id="nozzle-pump" type="number" min={1} max={99} required value={pump} onChange={(e) => setPump(e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field id="nozzle-number" label={t("spec.fuel.nozzle")} hint={t("spec.fuel.nozzle.hint")}>
            <Input id="nozzle-number" type="number" min={1} max={9} required value={number} onChange={(e) => setNumber(e.target.value)} className="text-right tabular-nums" />
          </Field>
        </div>
        <Field id="nozzle-tank" label={t("spec.fuel.tank")}>
          <Select
            id="nozzle-tank"
            value={tankId}
            onValueChange={setTankId}
            options={tanks.filter((x) => x.isActive || x.id === tankId).map((x) => ({ value: x.id, label: `${x.name} · ${x.itemName}` }))}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !pumpOk || !numberOk || !tankId}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- Fleet cards ----

const FLEET_GRID = "pos-fleet-cards";

function FleetCardsTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const grid = useDataGridUrlState(FLEET_GRID, 50);
  const [opened, setOpened] = useState<FleetCardResponse | "new" | null>(null);
  const cards = useQuery({
    queryKey: ["posFleetCards", activeCompanyId, grid.globalFilter],
    queryFn: () => apiClient.listPosFleetCards(activeCompanyId as string, grid.globalFilter || undefined),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const columns = useMemo<ColumnDef<FleetCardResponse>[]>(
    () => [
      { accessorKey: "number", header: t("spec.fleet.number"), cell: ({ getValue }) => <span className="tabular-nums">{getValue() as string}</span> },
      { accessorKey: "partnerName", header: t("spec.fleet.company") },
      { id: "plate", header: t("spec.fleet.plate"), accessorFn: (c) => c.vehiclePlate ?? "—" },
      { id: "driver", header: t("spec.fleet.driver"), accessorFn: (c) => c.driverName ?? "—" },
      {
        id: "limit",
        header: t("spec.fleet.limit"),
        meta: { numeric: true },
        accessorFn: (c) => c.limitPerFill,
        cell: ({ row }) => (row.original.limitPerFill == null ? t("spec.fleet.noLimit") : money(row.original.limitPerFill)),
      },
      { id: "fuelOnly", header: t("spec.fleet.fuelOnly"), accessorFn: (c) => (c.fuelOnly ? "✓" : "") },
      {
        id: "active",
        header: t("spec.status"),
        accessorFn: (c) => t(c.isActive ? "common.active" : "common.inactive"),
        cell: ({ row, getValue }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{getValue() as string}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const rows = cards.data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("spec.fuel.tab.fleet")}</CardTitle>
          <CardDescription>{t("spec.fleet.description")}</CardDescription>
        </div>
        {canApprove("pos") && (
          <Button size="sm" onClick={() => setOpened("new")}>
            <Plus className="size-4" /> {t("spec.fleet.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataGrid
          gridId={FLEET_GRID}
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={cards.isPending}
          getRowId={(c) => c.id}
          getRowClassName={(c) => (c.isActive ? undefined : "text-muted-foreground line-through")}
          onRowClick={canApprove("pos") ? setOpened : undefined}
          enableGlobalFilter
          globalFilterPlaceholder={t("spec.fleet.search")}
          emptyMessage={t("spec.fleet.empty")}
          exportFileName="fleet-cards"
        />
      </CardContent>
      {opened && <FleetCardEditDialog card={opened === "new" ? null : opened} onClose={() => setOpened(null)} />}
    </Card>
  );
}

function FleetCardEditDialog({ card, onClose }: { card: FleetCardResponse | null; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const customers = (usePartners().data ?? []).filter((p) => p.isCustomer);
  const [number, setNumber] = useState(card?.number ?? "");
  const [partnerId, setPartnerId] = useState(card?.partnerId ?? "");
  const [plate, setPlate] = useState(card?.vehiclePlate ?? "");
  const [driver, setDriver] = useState(card?.driverName ?? "");
  const [limit, setLimit] = useState(card?.limitPerFill != null ? String(card.limitPerFill) : "");
  const [fuelOnly, setFuelOnly] = useState(card?.fuelOnly ?? true);
  const [isActive, setIsActive] = useState(card?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (limitPerFill: number | undefined) => {
      const body = {
        number: number.trim(), partnerId, fuelOnly, isActive,
        ...(plate.trim() ? { vehiclePlate: plate.trim() } : {}),
        ...(driver.trim() ? { driverName: driver.trim() } : {}),
        ...(limitPerFill != null ? { limitPerFill } : {}),
      };
      return card ? apiClient.updatePosFleetCard(activeCompanyId as string, card.id, body) : apiClient.createPosFleetCard(activeCompanyId as string, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["posFleetCards", activeCompanyId] });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = limit.trim() === "" ? undefined : parseDecimal(limit, 2);
    if (value === null) {
      setError(t("spec.fleet.limit.invalid"));
      return;
    }
    save.mutate(value);
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={card ? card.number : t("spec.fleet.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert message={error} />
        <Field id="fleet-number" label={t("spec.fleet.number")}>
          <Input id="fleet-number" required maxLength={40} autoFocus value={number} onChange={(e) => setNumber(e.target.value)} className="tabular-nums" />
        </Field>
        <Field id="fleet-partner" label={t("spec.fleet.company")} hint={t("spec.fleet.company.hint")}>
          <SearchableSelect
            id="fleet-partner"
            value={partnerId}
            onChange={setPartnerId}
            placeholder={t("spec.pickCustomer")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("common.noResults")}
            options={customers.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="fleet-plate" label={t("spec.fleet.plate")}>
            <Input id="fleet-plate" maxLength={20} value={plate} onChange={(e) => setPlate(e.target.value)} />
          </Field>
          <Field id="fleet-driver" label={t("spec.fleet.driver")}>
            <Input id="fleet-driver" maxLength={120} value={driver} onChange={(e) => setDriver(e.target.value)} />
          </Field>
        </div>
        <Field id="fleet-limit" label={t("spec.fleet.limit")} hint={t("spec.fleet.limit.hint")}>
          <Input id="fleet-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className="text-right tabular-nums" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fuelOnly} onChange={(e) => setFuelOnly(e.target.checked)} />
          {t("spec.fleet.fuelOnly")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !number.trim() || !partnerId}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
