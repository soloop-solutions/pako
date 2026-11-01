import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeaseMeterResponse, LeaseResponse, SaveLeaseRequest } from "@pako/shared";
import { ArrowLeft, Gauge, Plus, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useItemLookup } from "@/hooks/useItemLookup";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePropertyUnits, vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate, isoToday } from "@/lib/sales-order-enums";
import { LeaseState } from "@/lib/verticals-enums";
import { ErrorAlert, Field, ItemField, LeaseStateBadge, PartnerField, Tile } from "@/pages/verticals/shared";
import { amount, formatMonth, gridKeyDown, parseNum, useT } from "@/pages/verticals/verticals-utils";

interface MeterRow { id?: string; name: string; itemId: string; itemName?: string; lastReading: string; pendingReading?: number }
const emptyMeter = (): MeterRow => ({ name: "", itemId: "", lastReading: "0" });

// docs/ERP_VERTICALS_PLAN.md §3 — one lease (qira): tenant (qiramarrës), the unit or a free-text
// property, rent, deposit (depozitë) and utility meters (njehsorë) re-billed with the rent.
export function LeaseDetail() {
  const intl = useIntl();
  const t = useT();
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const query = useQuery({
    queryKey: vxKeys.lease(activeCompanyId, id),
    queryFn: () => apiClient.getLease(activeCompanyId as string, id as string),
    enabled: !!activeCompanyId && !!id && !isNew,
  });
  const lease = query.data;
  const units = usePropertyUnits().data ?? [];
  const running = !!lease && lease.state !== LeaseState.Draft;
  const editable = canWrite("sales") && lease?.state !== LeaseState.Ended;

  const [tenantPartnerId, setTenant] = useState("");
  const [unitId, setUnitId] = useState("");
  const [property, setProperty] = useState("");
  const [startDate, setStartDate] = useState(isoToday());
  const [endDate, setEndDate] = useState("");
  const [rent, setRent] = useState("");
  const [rentItemId, setRentItemId] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [deposit, setDeposit] = useState("0");
  const [depositReceivedOn, setDepositReceivedOn] = useState("");
  const [depositReturnedOn, setDepositReturnedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [meters, setMeters] = useState<MeterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<LeaseMeterResponse | null>(null);
  const [ending, setEnding] = useState(false);
  const meterItems = useItemLookup(meters.map((m) => m.itemId));

  useEffect(() => {
    if (!lease) return;
    setTenant(lease.tenantPartnerId);
    setUnitId(lease.unitId ?? "");
    setProperty(lease.property ?? "");
    setStartDate(lease.startDate);
    setEndDate(lease.endDate ?? "");
    setRent(String(lease.rent));
    setRentItemId(lease.rentItemId);
    setDueDay(String(lease.dueDay));
    setDeposit(String(lease.deposit));
    setDepositReceivedOn(lease.depositReceivedOn ?? "");
    setDepositReturnedOn(lease.depositReturnedOn ?? "");
    setNotes(lease.notes ?? "");
    setMeters(lease.meters.map((m) => ({ id: m.id, name: m.name, itemId: m.itemId, itemName: m.itemName, lastReading: String(m.lastReading), pendingReading: m.pendingReading })));
  }, [lease]);

  function request(): SaveLeaseRequest {
    return {
      tenantPartnerId,
      startDate,
      rent: parseNum(rent) || 0,
      rentItemId,
      unitId: unitId || undefined,
      property: unitId ? undefined : property.trim() || undefined,
      endDate: endDate || undefined,
      dueDay: Number(dueDay) || 1,
      deposit: parseNum(deposit) || 0,
      depositReceivedOn: depositReceivedOn || undefined,
      depositReturnedOn: depositReturnedOn || undefined,
      notes: notes.trim() || undefined,
      meters: meters.filter((m) => m.name.trim() && m.itemId).map((m) => ({ name: m.name.trim(), itemId: m.itemId, lastReading: parseNum(m.lastReading) || 0 })),
    };
  }

  const onSaved = async (saved: LeaseResponse) => {
    queryClient.setQueryData(vxKeys.lease(activeCompanyId, saved.id), saved);
    await queryClient.invalidateQueries({ queryKey: vxKeys.leases(activeCompanyId) });
    if (isNew) navigate(`/rentals/leases/${saved.id}`, { replace: true });
  };
  const save = useMutation({
    mutationFn: () => (lease ? apiClient.updateLease(activeCompanyId as string, lease.id, request()) : apiClient.createLease(activeCompanyId as string, request())),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.lease.saveError"))),
  });
  const activate = useMutation({
    mutationFn: () => apiClient.activateLease(activeCompanyId as string, (lease as LeaseResponse).id),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.lease.activateError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tenantPartnerId) return setError(t("vx.lease.tenantRequired"));
    if (!rentItemId) return setError(t("vx.lease.rentItemRequired"));
    if (!unitId && !property.trim()) return setError(t("vx.lease.propertyRequired"));
    save.mutate();
  }

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  if (!isNew && !lease) return <p className="text-muted-foreground">{query.isError ? t("vx.lease.loadError") : t("common.loading")}</p>;

  const setMeter = (i: number, patch: Partial<MeterRow>) => setMeters((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const unitOptions = units.map((u) => ({ value: u.id, label: `${u.buildingName} · ${u.number}`, description: t(`vx.unitState.${u.state}`) }));
  if (lease?.unitId && !unitOptions.some((o) => o.value === lease.unitId)) unitOptions.unshift({ value: lease.unitId, label: lease.unitLabel ?? lease.unitId, description: "" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="xs" variant="ghost">
          <Link to="/rentals/leases"><ArrowLeft className="size-3.5" />{t("vx.nav.leases")}</Link>
        </Button>
        <h2 className="text-xl font-semibold">{lease ? `${lease.number} · ${lease.tenantName}` : t("vx.lease.new")}</h2>
        {lease && <LeaseStateBadge state={lease.state} />}
        <div className="ml-auto flex gap-2">
          {lease?.state === LeaseState.Draft && canWrite("sales") && (
            <Button size="sm" disabled={activate.isPending} onClick={() => { setError(null); activate.mutate(); }}>{t("vx.lease.activate")}</Button>
          )}
          {lease?.state === LeaseState.Active && canWrite("sales") && (
            <Button size="sm" variant="outline" onClick={() => setEnding(true)}>{t("vx.lease.end")}</Button>
          )}
        </div>
      </div>
      {lease && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={t("vx.lease.rent")} value={amount(lease.rent)} />
          <Tile label={t("vx.lease.lastInvoiced")} value={formatMonth(intl, lease.lastInvoicedPeriod)} />
          <Tile label={t("vx.lease.arrears")} value={amount(lease.arrears)} warn={lease.arrears > 0} />
        </div>
      )}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <ErrorAlert error={error} />
        <Card>
          <CardHeader>
            <CardTitle>{t("vx.lease.details")}</CardTitle>
            {running && <CardDescription>{t("vx.lease.runningHint")}</CardDescription>}
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PartnerField id="lease-tenant" label={t("vx.lease.tenant")} role="customer" value={tenantPartnerId} onChange={setTenant}
              disabled={!editable || running} fallbackLabel={lease?.tenantName} />
            <Field id="lease-unit" label={t("vx.lease.unit")} hint={t("vx.lease.unitHint")}>
              <SearchableSelect id="lease-unit" value={unitId} onChange={setUnitId} disabled={!editable || running} options={unitOptions}
                placeholder={t("vx.lease.noUnit")} emptyOptionLabel={t("vx.lease.noUnit")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")} />
            </Field>
            {!unitId && (
              <Field id="lease-property" label={t("vx.lease.property")} className="lg:col-span-2">
                <Input id="lease-property" value={property} disabled={!editable || running} onChange={(e) => setProperty(e.target.value)} />
              </Field>
            )}
            <Field id="lease-start" label={t("vx.lease.startDate")}>
              <Input id="lease-start" type="date" required value={startDate} disabled={!editable || running} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field id="lease-end" label={t("vx.lease.endDate")}>
              <Input id="lease-end" type="date" value={endDate} disabled={!editable} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field id="lease-rent" label={t("vx.lease.rentMonthly")} hint={t("vx.vatIncluded")}>
              <Input id="lease-rent" inputMode="decimal" className="text-right tnum" required value={rent} disabled={!editable || running} onChange={(e) => setRent(e.target.value)} />
            </Field>
            <ItemField id="lease-item" label={t("vx.lease.rentItem")} value={rentItemId} onChange={setRentItemId} disabled={!editable || running} />
            <Field id="lease-due" label={t("vx.lease.dueDay")} hint={t("vx.lease.dueDayHint")}>
              <Input id="lease-due" type="number" min={1} max={28} className="text-right tnum" value={dueDay} disabled={!editable} onChange={(e) => setDueDay(e.target.value)} />
            </Field>
            <Field id="lease-deposit" label={t("vx.lease.deposit")}>
              <Input id="lease-deposit" inputMode="decimal" className="text-right tnum" value={deposit} disabled={!editable} onChange={(e) => setDeposit(e.target.value)} />
            </Field>
            <Field id="lease-dep-in" label={t("vx.lease.depositReceivedOn")}>
              <Input id="lease-dep-in" type="date" value={depositReceivedOn} disabled={!editable} onChange={(e) => setDepositReceivedOn(e.target.value)} />
            </Field>
            <Field id="lease-dep-out" label={t("vx.lease.depositReturnedOn")}>
              <Input id="lease-dep-out" type="date" value={depositReturnedOn} disabled={!editable} onChange={(e) => setDepositReturnedOn(e.target.value)} />
            </Field>
            <Field id="lease-notes" label={t("vx.notes")} className="sm:col-span-2 lg:col-span-4">
              <Textarea id="lease-notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("vx.meters")}</CardTitle>
            <CardDescription>{t("vx.meters.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1" data-edit-grid>
            {meters.length > 0 && (
              <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(12rem,1.5fr)_8rem_8rem_auto] gap-2 text-xs font-medium text-muted-foreground">
                <span>{t("common.name")}</span><span>{t("vx.meters.item")}</span><span className="text-right">{t("vx.meters.lastReading")}</span>
                <span className="text-right">{t("vx.meters.pending")}</span><span />
              </div>
            )}
            {meters.map((m, i) => {
              const saved = lease?.meters.find((x) => x.id === m.id);
              const item = meterItems.find(m.itemId);
              const itemOptions = meterItems.search.items.map((it) => ({ value: it.id, label: `${it.code} · ${it.name}` }));
              if (m.itemId && !itemOptions.some((o) => o.value === m.itemId)) itemOptions.unshift({ value: m.itemId, label: item ? `${item.code} · ${item.name}` : m.itemName ?? m.itemId });
              return (
                <div key={m.id ?? `new-${i}`} className="grid grid-cols-[minmax(8rem,1fr)_minmax(12rem,1.5fr)_8rem_8rem_auto] items-center gap-2" data-testid="meter-row">
                  <Input className="h-7" aria-label={t("common.name")} value={m.name} disabled={!editable || !!saved} data-row={i} data-col="name"
                    onKeyDown={gridKeyDown} onChange={(e) => setMeter(i, { name: e.target.value })} />
                  <SearchableSelect value={m.itemId} onChange={(v) => setMeter(i, { itemId: v })} aria-label={t("vx.meters.item")} disabled={!editable || !!saved}
                    options={itemOptions} onSearchChange={meterItems.search.onSearchChange}
                    placeholder={t("vx.pickItem")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")} />
                  <Input className="h-7 text-right tnum" inputMode="decimal" aria-label={t("vx.meters.lastReading")} value={m.lastReading}
                    disabled={!editable || !!saved} data-row={i} data-col="reading" onKeyDown={gridKeyDown} onChange={(e) => setMeter(i, { lastReading: e.target.value })} />
                  <span className="text-right text-sm tnum">{saved?.pendingReading == null ? "—" : intl.formatNumber(saved.pendingReading)}</span>
                  <span className="flex gap-1">
                    {saved && lease?.state === LeaseState.Active && canWrite("sales") && (
                      <Button type="button" size="xs" variant="outline" onClick={() => setReading(saved)}>
                        <Gauge className="size-3.5" />{t("vx.meters.read")}
                      </Button>
                    )}
                    {editable && !saved && (
                      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t("common.remove")}
                        onClick={() => setMeters((ms) => ms.filter((_, j) => j !== i))}>
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
            {editable && (
              <Button type="button" size="xs" variant="ghost" className="w-fit" onClick={() => setMeters((ms) => [...ms, emptyMeter()])}>
                <Plus className="size-3.5" />{t("vx.meters.add")}
              </Button>
            )}
          </CardContent>
        </Card>
        {editable && (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>{save.isPending ? t("common.saving") : t("common.save")}</Button>
          </div>
        )}
      </form>
      {reading && lease && <MeterReadingDialog lease={lease} meter={reading} onClose={() => setReading(null)} onSaved={onSaved} />}
      {ending && lease && <EndLeaseDialog lease={lease} onClose={() => setEnding(false)} onSaved={onSaved} />}
      {lease?.endDate && lease.state === LeaseState.Ended && (
        <p className="text-sm text-muted-foreground">{t("vx.lease.endedOn", { date: formatIsoDate(intl, lease.endDate) })}</p>
      )}
    </div>
  );
}

function MeterReadingDialog({ lease, meter, onClose, onSaved }: {
  lease: LeaseResponse; meter: LeaseMeterResponse; onClose: () => void; onSaved: (l: LeaseResponse) => Promise<void>;
}) {
  const intl = useIntl();
  const t = useT();
  const { activeCompanyId } = useCompany();
  const [value, setValue] = useState(meter.pendingReading != null ? String(meter.pendingReading) : "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiClient.readLeaseMeter(activeCompanyId as string, lease.id, meter.id, { reading: parseNum(value) || 0 }),
    onSuccess: async (saved) => {
      await onSaved(saved);
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.meters.readError"))),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("vx.meters.readTitle", { meter: meter.name })} size="sm">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <ErrorAlert error={error} />
        <p className="text-sm text-muted-foreground">{t("vx.meters.readHint", { last: intl.formatNumber(meter.lastReading), item: meter.itemName })}</p>
        <Field id="meter-reading" label={t("vx.meters.reading")}>
          <Input id="meter-reading" inputMode="decimal" className="text-right tnum" required autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function EndLeaseDialog({ lease, onClose, onSaved }: { lease: LeaseResponse; onClose: () => void; onSaved: (l: LeaseResponse) => Promise<void> }) {
  const t = useT();
  const { activeCompanyId } = useCompany();
  const [endDate, setEndDate] = useState(lease.endDate ?? isoToday());
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiClient.endLease(activeCompanyId as string, lease.id, { endDate }),
    onSuccess: async (saved) => {
      await onSaved(saved);
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.lease.endError"))),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("vx.lease.endTitle", { number: lease.number })} size="sm">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <ErrorAlert error={error} />
        <Field id="lease-end-date" label={t("vx.lease.endDate")} hint={t("vx.lease.endHint")}>
          <Input id="lease-end-date" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("vx.lease.end")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
