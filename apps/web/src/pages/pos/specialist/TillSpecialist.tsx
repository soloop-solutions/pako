import { useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { FleetCardResponse, NozzleResponse, PartSearchResult, PrescriptionResponse, SubstituteResponse } from "@pako/shared";
import { ApiException } from "@pako/shared";
import { Fuel, Plus } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { PrescriptionState } from "@/lib/pos-enums";
import { cn } from "@/lib/utils";
import { ErrorAlert } from "@/pages/pos/hotel/hotel-shared";
import { MatchBadge, PartsSearchFields } from "@/pages/pos/specialist/PartsSearch";
import { PrescriptionForm } from "@/pages/pos/specialist/PrescriptionForm";
import { emptyPartsQuery, isPast, money, parseDecimal, qty, usePartsSearch, type PartsQuery } from "@/pages/pos/specialist/specialist-utils";

// docs/POS_PLAN.md P7 at the till: prescriptions and substitutes (pharmacy), nozzles and fleet cards
// (fuel station), the parts search (auto parts) and the attendant's check on a self-checkout lane.

const dispensable = (p: PrescriptionResponse) => p.state === PrescriptionState.Open || p.state === PrescriptionState.PartlyDispensed;

// ---- Pharmacy ----

/** Find an open prescription by its number or the patient, or type in a new one. */
export function TillPrescriptionDialog({ storeId, onPick, onClose }: {
  storeId: string;
  onPick: (prescription: PrescriptionResponse) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [creating, setCreating] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const list = useQuery({
    queryKey: ["posPrescriptions", activeCompanyId, "till", storeId, search],
    queryFn: () => apiClient.listPosPrescriptions(activeCompanyId as string, storeId, search || undefined, undefined, 1, 50),
    enabled: !!activeCompanyId && !creating,
    placeholderData: keepPreviousData,
  });
  const open = (list.data?.items ?? []).filter(dispensable);
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t(creating ? "spec.rx.new" : "spec.till.rx.title")} size={creating ? "lg" : "md"}>
      {creating ? (
        <PrescriptionForm storeId={storeId} onSaved={onPick} onCancel={() => setCreating(false)} />
      ) : (
        <div className="flex flex-col gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(typed.trim());
            }}
          >
            <Input
              autoFocus
              autoComplete="off"
              aria-label={t("spec.till.rx.search")}
              placeholder={t("spec.till.rx.search")}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <Button type="submit" variant="outline">{t("spec.parts.search")}</Button>
          </form>
          <ErrorAlert message={list.error ? getApiErrorMessage(list.error, t("spec.loadError")) : null} />
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {open.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full flex-col gap-1 rounded-md border p-2 text-left text-sm hover:bg-accent"
                  data-testid="till-prescription"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums">{p.number}</span>
                    <span>{p.patientName}</span>
                    {p.payerName && <Badge variant="outline">{p.payerName} {intl.formatNumber(p.coveragePercent)}%</Badge>}
                    {p.state === PrescriptionState.PartlyDispensed && <Badge variant="secondary">{t("spec.rx.state.partlyDispensed")}</Badge>}
                    {isPast(p.validUntil) && <Badge variant="destructive">{t("spec.rx.expired")}</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("spec.till.rx.byOn", { prescriber: p.prescriber, date: intl.formatDate(p.issuedOn) })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.lines.filter((l) => l.remaining > 0).map((l) => `${l.itemName} × ${qty(l.remaining)}`).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {list.data && open.length === 0 && <p className="text-sm text-muted-foreground">{t("spec.till.rx.none")}</p>}
          <div className="flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> {t("spec.rx.new")}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          </div>
        </div>
      )}
    </FormDialog>
  );
}

/** Other items with the same active ingredient, with the store's price and stock. */
export function SubstitutesDialog({ itemId, itemName, storeId, onPick, onClose }: {
  itemId: string;
  itemName: string;
  storeId: string;
  onPick: (substitute: SubstituteResponse) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const subs = useQuery({
    queryKey: ["posSubstitutes", activeCompanyId, itemId, storeId],
    queryFn: () => apiClient.getPosSubstitutes(activeCompanyId as string, itemId, storeId),
    enabled: !!activeCompanyId,
  });
  const rows = subs.data ?? [];
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("spec.till.subs.title", { item: itemName })} size="md">
      <div className="flex flex-col gap-3">
        <ErrorAlert message={subs.error ? getApiErrorMessage(subs.error, t("spec.loadError")) : null} />
        {subs.isPending && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {rows.map((s) => (
            <li key={s.itemId}>
              <button
                type="button"
                disabled={s.price == null}
                onClick={() => onPick(s)}
                className={cn("flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent", s.price == null && "opacity-50")}
                data-testid="till-substitute"
              >
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    {s.name}
                    {s.isPrescriptionOnly && <Badge variant="outline">{t("spec.rx.only")}</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    #{s.code}{s.atcCode ? ` · ${s.atcCode}` : ""}{s.activeIngredient ? ` · ${s.activeIngredient}` : ""}
                  </span>
                </span>
                <span className="flex flex-col items-end tabular-nums">
                  <span className="font-semibold">{s.price == null ? "—" : money(s.price)}</span>
                  <span className={cn("text-xs", s.onHand > 0 ? "text-muted-foreground" : "text-destructive")}>
                    {t("spec.till.subs.onHand", { qty: qty(s.onHand) })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {subs.data && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("spec.till.subs.none")}</p>}
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

// ---- Fuel station ----

/** The store's pumps and their nozzles: a tap starts a fill on that nozzle. */
export function NozzlePanel({ storeId, onNozzle }: { storeId: string; onNozzle: (nozzle: NozzleResponse) => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const nozzles = useQuery({
    queryKey: ["posNozzles", activeCompanyId, storeId],
    queryFn: () => apiClient.listPosFuelNozzles(activeCompanyId as string, storeId),
    enabled: !!activeCompanyId && !!storeId,
    staleTime: 5 * 60_000,
  });
  const pumps = useMemo(() => {
    const byPump = new Map<number, NozzleResponse[]>();
    for (const n of (nozzles.data ?? []).filter((x) => x.isActive)) byPump.set(n.pump, [...(byPump.get(n.pump) ?? []), n]);
    return [...byPump.entries()].sort((a, b) => a[0] - b[0]).map(([pump, list]) => ({ pump, list: list.sort((a, b) => a.number - b.number) }));
  }, [nozzles.data]);
  if (nozzles.data && pumps.length === 0) return <p className="text-sm text-muted-foreground">{t("spec.till.fuel.noNozzles")}</p>;
  return (
    <div className="flex flex-wrap gap-2" data-testid="nozzle-panel">
      {pumps.map(({ pump, list }) => (
        <div key={pump} className="flex flex-col gap-1 rounded-md border p-2">
          <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <Fuel className="size-3" /> {t("spec.fuel.pumpN", { pump })}
          </span>
          <div className="flex gap-1">
            {list.map((n) => (
              <Button key={n.id} type="button" variant="outline" className="h-12 min-w-20 flex-col gap-0" onMouseDown={(e) => e.preventDefault()} onClick={() => onNozzle(n)}>
                <span className="text-sm font-semibold">{t("spec.fuel.nozzleShort", { pump: n.pump, number: n.number })}</span>
                <span className="text-xs text-muted-foreground">{n.itemName}</span>
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The litres of a fill on a nozzle — as the pump shows them, never worked out from an amount. */
export function LitresPrompt({ nozzle, onLitres, onCancel }: { nozzle: NozzleResponse; onLitres: (litres: number) => void; onCancel: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    const litres = parseDecimal(value, 3);
    if (litres == null || !(litres > 0)) {
      setInvalid(true);
      return;
    }
    onLitres(litres);
  }
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onCancel()}
      title={t("spec.till.fuel.title", { pump: nozzle.pump, number: nozzle.number, grade: nozzle.itemName })}
      size="sm"
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Label htmlFor="till-litres">{t("spec.till.fuel.litres")}</Label>
        <Input
          id="till-litres"
          inputMode="decimal"
          autoFocus
          autoComplete="off"
          placeholder="0.00"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          className="h-12 text-right text-xl tabular-nums"
        />
        {invalid && <p className="text-sm text-destructive">{t("spec.till.fuel.invalid")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
          <Button type="submit">{t("till.add")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

/** A fleet card shown at the pump: the company it charges, the vehicle and the most one fill may take. */
export function FleetCardDialog({ onUse, onClose }: { onUse: (card: FleetCardResponse) => void; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [typed, setTyped] = useState("");
  const [number, setNumber] = useState<string | null>(null);
  const lookup = useQuery({
    queryKey: ["posFleetCard", activeCompanyId, number],
    queryFn: () => apiClient.lookupPosFleetCard(activeCompanyId as string, number as string),
    enabled: !!activeCompanyId && !!number,
    retry: false,
  });
  const card = lookup.data;
  const notFound = lookup.error instanceof ApiException && lookup.error.status === 404;
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("spec.till.fleet.title")} size="sm">
      <div className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) setNumber(typed.trim());
          }}
        >
          <Label htmlFor="till-fleet">{t("spec.fleet.number")}</Label>
          <div className="flex gap-2">
            <Input id="till-fleet" autoFocus autoComplete="off" maxLength={40} value={typed} onChange={(e) => setTyped(e.target.value)} className="h-12 text-lg tabular-nums" />
            <Button type="submit" variant="outline" className="h-12" disabled={!typed.trim()}>{t("spec.till.fleet.check")}</Button>
          </div>
        </form>
        {number && lookup.error && (
          <ErrorAlert message={notFound ? t("spec.till.fleet.notFound", { number }) : getApiErrorMessage(lookup.error, t("spec.loadError"))} />
        )}
        {card && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-2 text-sm" data-testid="fleet-card">
            <dt className="text-muted-foreground">{t("spec.fleet.company")}</dt>
            <dd className="font-semibold">{card.partnerName}</dd>
            <dt className="text-muted-foreground">{t("spec.fleet.plate")}</dt>
            <dd>{card.vehiclePlate ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("spec.fleet.driver")}</dt>
            <dd>{card.driverName ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("spec.fleet.limit")}</dt>
            <dd className="tabular-nums">{card.limitPerFill == null ? t("spec.fleet.noLimit") : money(card.limitPerFill)}</dd>
            {card.fuelOnly && <dd className="col-span-2 text-xs text-muted-foreground">{t("spec.fleet.fuelOnly.hint")}</dd>}
          </dl>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="button" disabled={!card} onClick={() => card && onUse(card)}>{t("spec.till.fleet.use")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

// ---- Auto parts ----

/** The parts search at the counter: the part picked goes into the basket at the till's price. */
export function TillPartsDialog({ onPick, onClose }: { onPick: (result: PartSearchResult) => void; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [query, setQuery] = useState<PartsQuery>(emptyPartsQuery);
  const results = usePartsSearch(query);
  const rows = results.data ?? [];
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("spec.nav.parts")} size="lg">
      <div className="flex flex-col gap-3">
        <PartsSearchFields initial={query} onSearch={setQuery} compact />
        <ErrorAlert message={results.error ? getApiErrorMessage(results.error, t("spec.loadError")) : null} />
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.itemId}>
              <button
                type="button"
                onClick={() => onPick(r)}
                className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent"
                data-testid="till-part"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">#{r.code} · {r.name}</span>
                  <MatchBadge result={r} />
                </span>
                <span className="flex flex-col items-end tabular-nums">
                  <span className="font-semibold">{r.price == null ? "—" : money(r.price)}</span>
                  <span className="text-xs text-muted-foreground">{t("spec.parts.onHand")}: {qty(r.onHand)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {results.data && rows.length === 0 && <p className="text-sm text-muted-foreground">{t("spec.parts.empty")}</p>}
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

// ---- Self-checkout ----

const PIN_PATTERN = /^\d{4,8}$/;

/**
 * An age-restricted item on a self-checkout lane: the attendant checks the customer's age and
 * confirms with their own PIN (the same PIN a waiter signs in with). The PIN is only checked here;
 * it does not sign the attendant in on the lane.
 */
export function AttendantPinDialog({ question, onVerified, onCancel }: {
  /** What the attendant confirms (the customer's age for an item, closing the lane). */
  question: string;
  onVerified: (attendant: string) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => apiClient.posPinSignIn(activeCompanyId as string, { pin }),
    onSuccess: (op) => onVerified(op.name),
    onError: (err: unknown) => {
      setPin("");
      setError(getApiErrorMessage(err, t("rest.waiter.wrongPin")));
    },
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && !check.isPending && onCancel()} title={t("spec.self.attendant.title")} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (PIN_PATTERN.test(pin)) check.mutate();
        }}
      >
        <p className="text-lg font-semibold">{question}</p>
        <ErrorAlert message={error} />
        <Label htmlFor="attendant-pin">{t("spec.self.attendant.pin")}</Label>
        <Input
          id="attendant-pin"
          type="password"
          inputMode="numeric"
          autoFocus
          autoComplete="off"
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className="h-12 text-center text-2xl tracking-widest"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={check.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!PIN_PATTERN.test(pin) || check.isPending}>{t("spec.self.attendant.confirm")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
