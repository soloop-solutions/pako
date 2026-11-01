import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveUnitRequest, UnitResponse } from "@pako/shared";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useBuildings, usePropertyUnits, vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate, isoToday } from "@/lib/sales-order-enums";
import { cn } from "@/lib/utils";
import { ReservationState, UNIT_KINDS, UNIT_STATES, UnitKind, UnitState } from "@/lib/verticals-enums";
import { BuildingDialog } from "@/pages/realestate/Buildings";
import { SaleContractDialog } from "@/pages/realestate/SaleContractDialog";
import { ErrorAlert, Field, PartnerField, StateFilter, UnitStateBadge } from "@/pages/verticals/shared";
import { amount, parseNum, unitCardClass, useT } from "@/pages/verticals/verticals-utils";

// docs/ERP_VERTICALS_PLAN.md §2 — one building: the unit board (banesa, lokale, parkingje),
// coloured by state; a unit opens to reserve it (rezervim, with a kapar) or sell it.
export function BuildingDetail() {
  const intl = useIntl();
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const building = (useBuildings().data ?? []).find((b) => b.id === id);
  const [state, setState] = useUrlParam("state", "");
  const [kind, setKind] = useUrlParam("kind", "");
  const [unitId, setUnitId] = useUrlParam("unit", "");
  const [editing, setEditing] = useState(false);
  const unitsQuery = usePropertyUnits(id, state === "" ? undefined : Number(state));
  const units = (unitsQuery.data ?? []).filter((u) => kind === "" || u.kind === Number(kind));
  const selected = unitId === "new" ? "new" : (unitsQuery.data ?? []).find((u) => u.id === unitId);

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="xs" variant="ghost">
          <Link to="/real-estate/buildings"><ArrowLeft className="size-3.5" />{t("vx.nav.buildings")}</Link>
        </Button>
        <h2 className="text-xl font-semibold">{building ? `${building.projectCode} · ${building.name}` : t("common.loading")}</h2>
        {building && canWrite("sales") && (
          <Button size="xs" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-3.5" />{t("common.edit")}</Button>
        )}
      </div>
      {building && (
        <p className="text-sm text-muted-foreground">
          {t("vx.building.summary", { units: building.units, available: building.available, reserved: building.reserved, sold: building.sold, rented: building.rented })}
          {building.address ? ` · ${building.address}` : ""}
        </p>
      )}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("vx.unit.board")}</CardTitle>
            <CardDescription>{t("vx.unit.boardHint")}</CardDescription>
          </div>
          {canWrite("sales") && (
            <Button size="sm" onClick={() => setUnitId("new")}><Plus className="size-4" />{t("vx.unit.new")}</Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <StateFilter value={state} onChange={setState} states={UNIT_STATES} labelPrefix="vx.unitState" label={t("vx.state")} />
            <StateFilter value={kind} onChange={setKind} states={UNIT_KINDS} labelPrefix="vx.unitKind" label={t("vx.unit.kind")} />
          </div>
          {unitsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : units.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("vx.unit.empty")}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2" data-testid="unit-board">
              {units.map((u) => (
                <button key={u.id} type="button" data-testid="unit-card" onClick={() => setUnitId(u.id)}
                  className={cn("flex flex-col items-start gap-0.5 rounded-md border p-2 text-left text-xs hover:ring-2 hover:ring-ring/40", unitCardClass[u.state])}>
                  <span className="flex w-full items-center justify-between gap-1">
                    <span className="text-sm font-semibold">{u.number}</span>
                    <UnitStateBadge state={u.state} />
                  </span>
                  <span>{t(`vx.unitKind.${u.kind}`)}{u.floor ? ` · ${t("vx.unit.floorShort", { floor: u.floor })}` : ""}</span>
                  <span className="tnum">{intl.formatNumber(u.area)} m² · {amount(u.listPrice)}</span>
                  {u.holderName && <span className="truncate">{u.holderName}</span>}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {editing && building && <BuildingDialog building={building} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {selected === "new" && id && <UnitFormDialog buildingId={id} onClose={() => setUnitId("")} />}
      {selected && selected !== "new" && (
        <UnitDialog unit={selected} onClose={() => setUnitId("")} onContract={(c) => navigate(`/real-estate/contracts/${c}`)} />
      )}
    </div>
  );
}

function UnitFormDialog({ buildingId, unit, onClose }: { buildingId: string; unit?: UnitResponse; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const [number, setNumber] = useState(unit?.number ?? "");
  const [kind, setKind] = useState<number>(unit?.kind ?? UnitKind.Apartment);
  const [area, setArea] = useState(unit ? String(unit.area) : "");
  const [listPrice, setListPrice] = useState(unit ? String(unit.listPrice) : "");
  const [floor, setFloor] = useState(unit?.floor ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body: SaveUnitRequest = { buildingId, number: number.trim(), kind, area: parseNum(area) || 0, listPrice: parseNum(listPrice) || 0, floor: floor.trim() || undefined };
      return unit ? apiClient.updatePropertyUnit(activeCompanyId as string, unit.id, body) : apiClient.createPropertyUnit(activeCompanyId as string, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: vxKeys.units(activeCompanyId) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.buildings(activeCompanyId) });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.unit.saveError"))),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={unit ? t("vx.unit.title", { number: unit.number }) : t("vx.unit.new")} size="sm">
      <form className="flex flex-col gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <ErrorAlert error={error} />
        <div className="grid grid-cols-2 gap-3">
          <Field id="unit-number" label={t("vx.unit.number")}>
            <Input id="unit-number" required maxLength={20} value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field id="unit-floor" label={t("vx.unit.floor")}>
            <Input id="unit-floor" maxLength={20} value={floor} onChange={(e) => setFloor(e.target.value)} />
          </Field>
          <Field id="unit-kind" label={t("vx.unit.kind")}>
            <Select id="unit-kind" value={String(kind)} onValueChange={(v) => setKind(Number(v))}
              options={UNIT_KINDS.map((k) => ({ value: String(k), label: t(`vx.unitKind.${k}`) }))} />
          </Field>
          <Field id="unit-area" label={t("vx.unit.area")}>
            <Input id="unit-area" inputMode="decimal" className="text-right tnum" required value={area} onChange={(e) => setArea(e.target.value)} />
          </Field>
          <Field id="unit-price" label={t("vx.unit.listPrice")} hint={t("vx.vatIncluded")} className="col-span-2">
            <Input id="unit-price" inputMode="decimal" className="text-right tnum" required value={listPrice} onChange={(e) => setListPrice(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function UnitDialog({ unit, onClose, onContract }: { unit: UnitResponse; onClose: () => void; onContract: (contractId: string) => void }) {
  const intl = useIntl();
  const t = useT();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const [mode, setMode] = useState<"view" | "edit" | "reserve" | "sell">("view");
  const reservationsQuery = useQuery({
    queryKey: [...vxKeys.reservations(activeCompanyId), String(ReservationState.Active)],
    queryFn: () => apiClient.listUnitReservations(activeCompanyId as string, ReservationState.Active),
    enabled: !!activeCompanyId && unit.state === UnitState.Reserved,
  });
  const reservation = (reservationsQuery.data ?? []).find((r) => r.unitId === unit.id);
  const [partnerId, setPartnerId] = useState("");
  const [date, setDate] = useState(isoToday());
  const [expiresOn, setExpiresOn] = useState("");
  const [deposit, setDeposit] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reserve = useMutation({
    mutationFn: () => apiClient.createUnitReservation(activeCompanyId as string, {
      unitId: unit.id, partnerId, date, expiresOn, deposit: parseNum(deposit) || 0, notes: notes.trim() || undefined,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: vxKeys.units(activeCompanyId) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.reservations(activeCompanyId) });
      await queryClient.invalidateQueries({ queryKey: vxKeys.buildings(activeCompanyId) });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("vx.reservation.saveError"))),
  });

  if (mode === "edit") return <UnitFormDialog buildingId={unit.buildingId} unit={unit} onClose={onClose} />;
  if (mode === "sell") {
    return (
      <SaleContractDialog unit={unit} onClose={onClose} onSaved={(c) => onContract(c.id)}
        reservation={reservation ? { id: reservation.id, partnerId: reservation.partnerId, partnerName: reservation.partnerName } : undefined} />
    );
  }
  const canSell = unit.state === UnitState.Available || unit.state === UnitState.Reserved;

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("vx.unit.title", { number: `${unit.buildingName} · ${unit.number}` })} size="sm">
      <div className="flex flex-col gap-3">
        <ErrorAlert error={error} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("vx.state")}</dt><dd><UnitStateBadge state={unit.state} /></dd>
          <dt className="text-muted-foreground">{t("vx.unit.kind")}</dt><dd>{t(`vx.unitKind.${unit.kind}`)}</dd>
          <dt className="text-muted-foreground">{t("vx.unit.floor")}</dt><dd>{unit.floor ?? "—"}</dd>
          <dt className="text-muted-foreground">{t("vx.unit.area")}</dt><dd className="tnum">{intl.formatNumber(unit.area)} m²</dd>
          <dt className="text-muted-foreground">{t("vx.unit.listPrice")}</dt><dd className="tnum">{amount(unit.listPrice)}</dd>
          <dt className="text-muted-foreground">{t("vx.unit.pricePerM2")}</dt><dd className="tnum">{unit.pricePerSquareMetre == null ? "—" : amount(unit.pricePerSquareMetre)}</dd>
          {unit.holderName && (<><dt className="text-muted-foreground">{t("vx.unit.holder")}</dt><dd>{unit.holderName}</dd></>)}
          {reservation && (
            <><dt className="text-muted-foreground">{t("vx.reservation.expiresOn")}</dt><dd>{formatIsoDate(intl, reservation.expiresOn)} · {t("vx.reservation.deposit")} {amount(reservation.deposit)}</dd></>
          )}
        </dl>
        {mode === "reserve" ? (
          <form className="flex flex-col gap-3 border-t pt-3" onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!partnerId) return setError(t("vx.reservation.partnerRequired"));
            reserve.mutate();
          }}>
            <PartnerField id="res-partner" label={t("vx.reservation.customer")} role="customer" value={partnerId} onChange={setPartnerId} />
            <div className="grid grid-cols-2 gap-3">
              <Field id="res-date" label={t("common.date")}>
                <Input id="res-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field id="res-expires" label={t("vx.reservation.expiresOn")}>
                <Input id="res-expires" type="date" required value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </Field>
              <Field id="res-deposit" label={t("vx.reservation.deposit")} className="col-span-2">
                <Input id="res-deposit" inputMode="decimal" className="text-right tnum" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="res-notes">{t("vx.notes")}</Label>
              <Textarea id="res-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("view")}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={reserve.isPending}>{t("vx.reservation.reserve")}</Button>
            </div>
          </form>
        ) : (
          canWrite("sales") && (
            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setMode("edit")}>{t("common.edit")}</Button>
              {unit.state === UnitState.Available && (
                <Button type="button" variant="outline" size="sm" onClick={() => setMode("reserve")}>{t("vx.reservation.reserve")}</Button>
              )}
              {canSell && <Button type="button" size="sm" onClick={() => setMode("sell")}>{t("vx.unit.sell")}</Button>}
            </div>
          )
        )}
      </div>
    </FormDialog>
  );
}
