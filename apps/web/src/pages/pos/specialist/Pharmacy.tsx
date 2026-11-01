import { forwardRef, useMemo, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { ControlledRegisterResponse, ControlledRegisterRow, PayerResponse, PrescriptionResponse } from "@pako/shared";
import { Plus, Printer } from "lucide-react";
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
import { usePosStores } from "@/hooks/usePos";
import { useItemSearch } from "@/hooks/useStock";
import { useUrlParam } from "@/hooks/useUrlParam";
import { PRESCRIPTION_STATES, PrescriptionState, prescriptionStateKey } from "@/lib/pos-enums";
import { addDays, todayLocal } from "@/lib/pos-services";
import { printElement } from "@/lib/print";
import { ConfirmDialog, ErrorAlert } from "@/pages/pos/hotel/hotel-shared";
import { isIsoDate } from "@/pages/pos/hotel/hotel-utils";
import { PrescriptionForm } from "@/pages/pos/specialist/PrescriptionForm";
import { Field, TabBar } from "@/pages/pos/specialist/shared";
import { isPast, parseDecimal, qty, usePartners } from "@/pages/pos/specialist/specialist-utils";

type Tab = "prescriptions" | "payers" | "controlled";
const TABS: Tab[] = ["prescriptions", "payers", "controlled"];
const ALL = "all";
const RX_GRID = "pos-prescriptions";

// docs/POS_PLAN.md §6.8 / P7: the pharmacy back office — prescriptions (recetat), the payers that
// cover part of them (the health insurance fund, insurers) and the controlled-substances register.
export function Pharmacy() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const [tabParam, setTab] = useUrlParam("tab", "prescriptions");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "prescriptions";
  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <TabBar
        label={t("spec.nav.pharmacy")}
        value={tab}
        onChange={setTab}
        tabs={TABS.map((id) => ({ id, label: t(`spec.pharmacy.tab.${id}`) }))}
      />
      {tab === "prescriptions" && <PrescriptionsTab />}
      {tab === "payers" && <PayersTab />}
      {tab === "controlled" && <ControlledRegisterTab />}
    </div>
  );
}

// ---- Prescriptions ----

function PrescriptionsTab() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const stores = usePosStores().data ?? [];
  const grid = useDataGridUrlState(RX_GRID, 50);
  const [store, setStore] = useUrlParam("store", ALL, [`${RX_GRID}.page`]);
  const [state, setState] = useUrlParam("state", ALL, [`${RX_GRID}.page`]);
  const [opened, setOpened] = useState<PrescriptionResponse | "new" | null>(null);

  const list = useQuery({
    queryKey: ["posPrescriptions", activeCompanyId, store, state, grid.globalFilter, grid.page, grid.pageSize],
    queryFn: () =>
      apiClient.listPosPrescriptions(
        activeCompanyId as string, store === ALL ? undefined : store, grid.globalFilter || undefined, state === ALL ? undefined : Number(state), grid.page, grid.pageSize,
      ),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["posPrescriptions", activeCompanyId] });

  const columns = useMemo<ColumnDef<PrescriptionResponse>[]>(
    () => [
      { accessorKey: "number", header: t("spec.rx.number"), cell: ({ getValue }) => <span className="tabular-nums">{getValue() as string}</span> },
      { id: "issuedOn", header: t("spec.rx.issuedOn"), accessorFn: (p) => intl.formatDate(p.issuedOn) },
      { id: "validUntil", header: t("spec.rx.validUntil"), accessorFn: (p) => (p.validUntil ? intl.formatDate(p.validUntil) : "—") },
      { accessorKey: "patientName", header: t("spec.rx.patient") },
      { accessorKey: "prescriber", header: t("spec.rx.prescriber") },
      { id: "payer", header: t("spec.rx.payer"), accessorFn: (p) => (p.payerName ? `${p.payerName} · ${intl.formatNumber(p.coveragePercent)}%` : "—") },
      {
        id: "state",
        header: t("spec.status"),
        accessorFn: (p) => t(`spec.rx.state.${prescriptionStateKey(p.state)}`),
        cell: ({ row, getValue }) => (
          <span className="flex items-center gap-1">
            <Badge variant={row.original.state === PrescriptionState.Open ? "default" : row.original.state === PrescriptionState.PartlyDispensed ? "outline" : "secondary"}>
              {getValue() as string}
            </Badge>
            {isPast(row.original.validUntil) && row.original.state < PrescriptionState.Dispensed && <Badge variant="destructive">{t("spec.rx.expired")}</Badge>}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("spec.pharmacy.tab.prescriptions")}</CardTitle>
          <CardDescription>{t("spec.rx.description")}</CardDescription>
        </div>
        {canWrite("pos") && (
          <Button size="sm" onClick={() => setOpened("new")}>
            <Plus className="size-4" /> {t("spec.rx.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Field id="rx-filter-store" label={t("spec.store")} className="w-56">
            <Select
              id="rx-filter-store"
              value={store}
              onValueChange={setStore}
              options={[{ value: ALL, label: t("spec.allStores") }, ...stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))]}
            />
          </Field>
          <Field id="rx-filter-state" label={t("spec.status")} className="w-56">
            <Select
              id="rx-filter-state"
              value={state}
              onValueChange={setState}
              options={[{ value: ALL, label: t("spec.rx.state.all") }, ...PRESCRIPTION_STATES.map((s) => ({ value: String(s), label: t(`spec.rx.state.${prescriptionStateKey(s)}`) }))]}
            />
          </Field>
        </div>
        <ErrorAlert message={list.error ? getApiErrorMessage(list.error, t("spec.loadError")) : null} />
        <DataGrid
          gridId={RX_GRID}
          columns={columns}
          data={list.data?.items ?? []}
          rowCount={list.data?.total ?? 0}
          isLoading={list.isPending}
          getRowId={(p) => p.id}
          getRowClassName={(p) => (p.state === PrescriptionState.Cancelled ? "text-muted-foreground line-through" : p.state === PrescriptionState.Dispensed ? "text-muted-foreground" : undefined)}
          onRowClick={setOpened}
          enableGlobalFilter
          globalFilterPlaceholder={t("spec.rx.search")}
          emptyMessage={t("spec.rx.empty")}
          exportFileName="prescriptions"
        />
      </CardContent>
      {opened && (
        <PrescriptionDialog
          prescription={opened === "new" ? null : opened}
          onClose={() => setOpened(null)}
          onChanged={(p) => {
            void refresh();
            setOpened(p);
          }}
        />
      )}
    </Card>
  );
}

function PrescriptionDialog({ prescription, onClose, onChanged }: {
  prescription: PrescriptionResponse | null;
  onClose: () => void;
  onChanged: (p: PrescriptionResponse | null) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const [editing, setEditing] = useState(prescription === null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => apiClient.cancelPosPrescription(activeCompanyId as string, (prescription as PrescriptionResponse).id),
    onSuccess: (p) => {
      setConfirming(false);
      onChanged(p);
    },
    onError: (err: unknown) => {
      setConfirming(false);
      setError(getApiErrorMessage(err, t("pos.saveError")));
    },
  });
  const p = prescription;
  // Changed only while nothing was dispensed from it; cancelled while something is left to give.
  const untouched = !!p && p.state === PrescriptionState.Open && p.lines.every((l) => l.dispensed === 0);
  const cancellable = !!p && (p.state === PrescriptionState.Open || p.state === PrescriptionState.PartlyDispensed);
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={p ? t("spec.rx.title", { number: p.number }) : t("spec.rx.new")} size="lg">
      {editing ? (
        <PrescriptionForm
          initial={p ?? undefined}
          onSaved={(saved) => {
            setEditing(false);
            onChanged(saved);
          }}
          onCancel={() => (p ? setEditing(false) : onClose())}
        />
      ) : p ? (
        <div className="flex flex-col gap-3">
          <ErrorAlert message={error} />
          <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("spec.rx.patient")}</dt>
            <dd>{p.patientName}{p.patientPersonalNumber ? ` · ${p.patientPersonalNumber}` : ""}</dd>
            <dt className="text-muted-foreground">{t("spec.rx.prescriber")}</dt>
            <dd>{p.prescriber}{p.prescriberLicence ? ` · ${p.prescriberLicence}` : ""}</dd>
            <dt className="text-muted-foreground">{t("spec.rx.issuedOn")}</dt>
            <dd>{intl.formatDate(p.issuedOn)}</dd>
            <dt className="text-muted-foreground">{t("spec.rx.validUntil")}</dt>
            <dd className={isPast(p.validUntil) ? "text-destructive" : undefined}>{p.validUntil ? intl.formatDate(p.validUntil) : "—"}</dd>
            <dt className="text-muted-foreground">{t("spec.rx.payer")}</dt>
            <dd>{p.payerName ? `${p.payerName} · ${intl.formatNumber(p.coveragePercent)}%` : t("spec.rx.payer.none")}</dd>
            <dt className="text-muted-foreground">{t("spec.status")}</dt>
            <dd>{t(`spec.rx.state.${prescriptionStateKey(p.state)}`)}</dd>
          </dl>
          {p.notes && <p className="text-sm text-muted-foreground">{p.notes}</p>}
          <div className="flex flex-col divide-y rounded-md border text-sm" data-testid="rx-lines">
            <div className="grid grid-cols-[1fr_5rem_5rem_5rem_10rem] gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              <span>{t("spec.rx.medicine")}</span>
              <span className="text-right">{t("spec.rx.prescribed")}</span>
              <span className="text-right">{t("spec.rx.dispensed")}</span>
              <span className="text-right">{t("spec.rx.remaining")}</span>
              <span>{t("spec.rx.dosage")}</span>
            </div>
            {p.lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[1fr_5rem_5rem_5rem_10rem] gap-2 px-2 py-1 tabular-nums">
                <span>{l.itemName}</span>
                <span className="text-right">{qty(l.quantity)}</span>
                <span className="text-right">{qty(l.dispensed)}</span>
                <span className={l.remaining > 0 ? "text-right font-semibold" : "text-right text-muted-foreground"}>{qty(l.remaining)}</span>
                <span className="truncate">{l.dosage ?? ""}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {canApprove("pos") && cancellable && (
              <Button variant="destructive" onClick={() => setConfirming(true)}>{t("spec.rx.cancel")}</Button>
            )}
            {canWrite("pos") && untouched && <Button variant="outline" onClick={() => setEditing(true)}>{t("common.edit")}</Button>}
            <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      ) : null}
      {confirming && p && (
        <ConfirmDialog
          title={t("spec.rx.cancel")}
          body={t("spec.rx.cancel.confirm", { number: p.number })}
          confirm={t("spec.rx.cancel")}
          busy={cancel.isPending}
          onConfirm={() => cancel.mutate()}
          onClose={() => setConfirming(false)}
        />
      )}
    </FormDialog>
  );
}

// ---- Payers ----

function PayersTab() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const { canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<PayerResponse | "new" | null>(null);
  const payers = useQuery({
    queryKey: ["posPayers", activeCompanyId],
    queryFn: () => apiClient.listPosPayers(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const columns = useMemo<ColumnDef<PayerResponse>[]>(
    () => [
      { accessorKey: "name", header: t("common.name") },
      { accessorKey: "partnerName", header: t("spec.payer.partner") },
      { accessorKey: "coveragePercent", header: t("spec.payer.coverage"), meta: { numeric: true }, cell: ({ getValue }) => `${intl.formatNumber(getValue() as number)}%` },
      {
        id: "active",
        header: t("spec.status"),
        accessorFn: (p) => t(p.isActive ? "common.active" : "common.inactive"),
        cell: ({ row, getValue }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{getValue() as string}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const rows = payers.data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("spec.pharmacy.tab.payers")}</CardTitle>
          <CardDescription>{t("spec.payer.description")}</CardDescription>
        </div>
        {canApprove("pos") && (
          <Button size="sm" onClick={() => setOpened("new")}>
            <Plus className="size-4" /> {t("spec.payer.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!canApprove("pos") && <p className="text-sm text-muted-foreground">{t("spec.approveOnly")}</p>}
        <DataGrid
          gridId="pos-payers"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={payers.isPending}
          getRowId={(p) => p.id}
          getRowClassName={(p) => (p.isActive ? undefined : "text-muted-foreground")}
          onRowClick={canApprove("pos") ? setOpened : undefined}
          emptyMessage={t("spec.payer.empty")}
          exportFileName="payers"
        />
      </CardContent>
      {opened && (
        <PayerDialog
          payer={opened === "new" ? null : opened}
          onClose={() => setOpened(null)}
          onSaved={async () => {
            setOpened(null);
            await queryClient.invalidateQueries({ queryKey: ["posPayers", activeCompanyId] });
          }}
        />
      )}
    </Card>
  );
}

function PayerDialog({ payer, onClose, onSaved }: { payer: PayerResponse | null; onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const customers = (usePartners().data ?? []).filter((p) => p.isCustomer);
  const [name, setName] = useState(payer?.name ?? "");
  const [partnerId, setPartnerId] = useState(payer?.partnerId ?? "");
  const [coverage, setCoverage] = useState(payer ? String(payer.coveragePercent) : "");
  const [isActive, setIsActive] = useState(payer?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (coveragePercent: number) => {
      const body = { name: name.trim(), partnerId, coveragePercent, isActive };
      return payer ? apiClient.updatePosPayer(activeCompanyId as string, payer.id, body) : apiClient.createPosPayer(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = parseDecimal(coverage, 2);
    if (value == null || value > 100) {
      setError(t("spec.rx.coverageInvalid"));
      return;
    }
    save.mutate(value);
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={payer ? payer.name : t("spec.payer.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <ErrorAlert message={error} />
        <Field id="payer-name" label={t("common.name")}>
          <Input id="payer-name" required maxLength={120} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="payer-partner" label={t("spec.payer.partner")} hint={t("spec.payer.partner.hint")}>
          <SearchableSelect
            id="payer-partner"
            value={partnerId}
            onChange={setPartnerId}
            placeholder={t("spec.pickCustomer")}
            searchPlaceholder={t("common.search")}
            noResultsText={t("common.noResults")}
            options={customers.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
          />
        </Field>
        <Field id="payer-coverage" label={t("spec.payer.coverage")} hint={t("spec.payer.coverage.hint")}>
          <Input id="payer-coverage" inputMode="decimal" required value={coverage} onChange={(e) => setCoverage(e.target.value)} className="text-right tabular-nums" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending || !name.trim() || !partnerId}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- Controlled substances register ----

function ControlledRegisterTab() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId, activeCompany } = useCompany();
  const { canApprove } = useMyAccess();
  const itemSearch = useItemSearch();
  const [itemId, setItemId] = useUrlParam("item");
  const [from, setFrom] = useUrlParam("from", addDays(todayLocal(), -30));
  const [to, setTo] = useUrlParam("to", todayLocal());
  const printRef = useRef<HTMLDivElement>(null);
  const valid = isIsoDate(from) && isIsoDate(to) && to >= from;
  const report = useQuery({
    queryKey: ["posControlledRegister", activeCompanyId, itemId, from, to],
    queryFn: () => apiClient.getPosControlledRegister(activeCompanyId as string, itemId, from, to),
    enabled: !!activeCompanyId && !!itemId && valid && canApprove("pos"),
    placeholderData: keepPreviousData,
  });
  const options = useMemo(() => {
    const controlled = itemSearch.items.filter((i) => i.isControlled);
    return controlled.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, description: i.activeIngredient ?? undefined }));
  }, [itemSearch.items]);
  const columns = useMemo<ColumnDef<ControlledRegisterRow>[]>(
    () => [
      { id: "date", header: t("common.date"), accessorFn: (r) => intl.formatDate(r.date) },
      { accessorKey: "document", header: t("spec.ctrl.document") },
      { id: "counterparty", header: t("spec.ctrl.counterparty"), accessorFn: (r) => r.counterparty ?? "" },
      { id: "prescription", header: t("spec.rx.number"), accessorFn: (r) => r.prescriptionNumber ?? "" },
      { id: "patient", header: t("spec.rx.patient"), accessorFn: (r) => r.patient ?? "" },
      { id: "prescriber", header: t("spec.rx.prescriber"), accessorFn: (r) => r.prescriber ?? "" },
      { accessorKey: "in", header: t("spec.ctrl.in"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { accessorKey: "out", header: t("spec.ctrl.out"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
      { accessorKey: "balance", header: t("spec.ctrl.balance"), meta: { numeric: true }, cell: ({ getValue }) => qty(getValue() as number) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );
  const data = report.data;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("spec.pharmacy.tab.controlled")}</CardTitle>
          <CardDescription>{t("spec.ctrl.description")}</CardDescription>
        </div>
        {data && (
          <Button size="sm" variant="outline" onClick={() => printRef.current && printElement(printRef.current)}>
            <Printer className="size-4" /> {t("common.print")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!canApprove("pos") ? (
          <p className="text-sm text-muted-foreground">{t("spec.ctrl.approveOnly")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field id="ctrl-item" label={t("spec.ctrl.item")} className="w-80">
                <SearchableSelect
                  id="ctrl-item"
                  value={itemId}
                  onChange={setItemId}
                  onSearchChange={itemSearch.onSearchChange}
                  placeholder={data?.itemName ?? t("spec.ctrl.item.pick")}
                  searchPlaceholder={t("common.search")}
                  noResultsText={t("spec.ctrl.item.none")}
                  options={options}
                />
              </Field>
              <Field id="ctrl-from" label={t("spec.from")} className="w-40">
                <Input id="ctrl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field id="ctrl-to" label={t("spec.to")} className="w-40">
                <Input id="ctrl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <ErrorAlert message={report.error ? getApiErrorMessage(report.error, t("spec.loadError")) : null} />
            {data && (
              <>
                <div className="flex gap-6 text-sm tabular-nums" data-testid="ctrl-totals">
                  <span>{t("spec.ctrl.opening")}: <strong>{qty(data.opening)}</strong></span>
                  <span>{t("spec.ctrl.closing")}: <strong>{qty(data.closing)}</strong></span>
                </div>
                <DataGrid
                  gridId="pos-controlled-register"
                  columns={columns}
                  data={data.rows}
                  rowCount={data.rows.length}
                  isLoading={report.isFetching}
                  emptyMessage={t("spec.ctrl.empty")}
                  exportFileName="controlled-register"
                  manualSorting={false}
                />
                <div className="hidden">
                  <ControlledRegisterPrint ref={printRef} report={data} companyName={activeCompany?.name ?? ""} />
                </div>
              </>
            )}
            {!itemId && <p className="text-sm text-muted-foreground">{t("spec.ctrl.prompt")}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// The register on A4, as kept for the pharmaceutical inspectorate: every movement of the substance
// with the prescription it went out on, opening and closing balances. Quantities only.
const ControlledRegisterPrint = forwardRef<HTMLDivElement, { report: ControlledRegisterResponse; companyName: string }>(
  function ControlledRegisterPrint({ report, companyName }, ref) {
    const intl = useIntl();
    const t = (id: string) => intl.formatMessage({ id });
    return (
      <div ref={ref} className="flex flex-col gap-4 bg-white p-2 text-[11px] text-black">
        <header className="flex items-start justify-between gap-4 border-b border-black pb-2">
          <p className="text-base font-bold">{companyName}</p>
          <div className="text-right">
            <p className="text-base font-bold">{t("spec.pharmacy.tab.controlled")}</p>
            <p>{report.itemName}</p>
            <p>{intl.formatDate(report.from)} – {intl.formatDate(report.to)}</p>
          </div>
        </header>
        <p>{t("spec.ctrl.opening")}: <strong className="tabular-nums">{qty(report.opening)}</strong></p>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1">{t("common.date")}</th>
              <th className="py-1">{t("spec.ctrl.document")}</th>
              <th className="py-1">{t("spec.ctrl.counterparty")}</th>
              <th className="py-1">{t("spec.rx.number")}</th>
              <th className="py-1">{t("spec.rx.patient")}</th>
              <th className="py-1">{t("spec.rx.prescriber")}</th>
              <th className="py-1 text-right">{t("spec.ctrl.in")}</th>
              <th className="py-1 text-right">{t("spec.ctrl.out")}</th>
              <th className="py-1 text-right">{t("spec.ctrl.balance")}</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i} className="border-b border-neutral-300">
                <td className="py-1">{intl.formatDate(r.date)}</td>
                <td className="py-1">{r.document}</td>
                <td className="py-1">{r.counterparty ?? ""}</td>
                <td className="py-1">{r.prescriptionNumber ?? ""}</td>
                <td className="py-1">{r.patient ?? ""}</td>
                <td className="py-1">{r.prescriber ?? ""}</td>
                <td className="py-1 text-right tabular-nums">{r.in ? qty(r.in) : ""}</td>
                <td className="py-1 text-right tabular-nums">{r.out ? qty(r.out) : ""}</td>
                <td className="py-1 text-right tabular-nums">{qty(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>{t("spec.ctrl.closing")}: <strong className="tabular-nums">{qty(report.closing)}</strong></p>
        <div className="mt-8 grid grid-cols-2 gap-8">
          <p className="border-t border-black pt-1">{t("spec.ctrl.signPharmacist")}</p>
          <p className="border-t border-black pt-1">{t("spec.ctrl.signDate")}</p>
        </div>
      </div>
    );
  },
);
