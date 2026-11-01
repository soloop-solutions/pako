import { useMemo, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppointmentResponse, ResourceResponse } from "@pako/shared";
import { ChevronLeft, ChevronRight, Globe, Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosRegisters, usePosStores } from "@/hooks/usePos";
import { resourcesKey } from "@/hooks/usePosServices";
import { useItemSearch } from "@/hooks/useStock";
import { useUrlParam } from "@/hooks/useUrlParam";
import {
  AppointmentSource,
  AppointmentState,
  addDays,
  appointmentStateKey,
  localDate,
  localMinutes,
  localTime,
  minutesOf,
  parseUtc,
  pickTillRegister,
  timeOf,
  todayLocal,
  utcFromLocal,
  weekStart,
} from "@/lib/pos-services";
import { cn } from "@/lib/utils";

const money = (v: number | undefined) => (v ?? 0).toFixed(2);
const PX_PER_MIN = 1.2;
const SLOT = 30;

// State shows in form: booked outlined, confirmed solid, checked in warm, completed muted,
// no-show and cancelled struck through.
const STATE_CLASS: Record<number, string> = {
  [AppointmentState.Booked]: "border-sky-400 bg-sky-50 text-sky-950 dark:bg-sky-950/60 dark:text-sky-100",
  [AppointmentState.Confirmed]: "border-indigo-500 bg-indigo-100 text-indigo-950 dark:bg-indigo-900/70 dark:text-indigo-50",
  [AppointmentState.CheckedIn]: "border-amber-500 bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-50",
  [AppointmentState.Completed]: "border-emerald-500 bg-emerald-50 text-emerald-900 opacity-80 dark:bg-emerald-950/60 dark:text-emerald-100",
  [AppointmentState.NoShow]: "border-rose-400 bg-rose-50 text-rose-900 line-through opacity-70 dark:bg-rose-950/60 dark:text-rose-100",
  [AppointmentState.Cancelled]: "border-muted bg-muted text-muted-foreground line-through opacity-60",
};

const isClosed = (a: AppointmentResponse) => a.state === AppointmentState.Completed || a.state === AppointmentState.Cancelled;

/** Where a booking starts when an empty slot is clicked. */
interface SlotPick {
  date: string;
  time: string;
  resourceId: string;
}

// docs/POS_PLAN.md §6.9 / P4: the appointments calendar — a column per resource (day) or per day
// (week), in Kosovo time. Booking offers the free starts the server works out; checking out
// happens at the till, which settles the appointment with the sale.
export function Appointments() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const stores = (usePosStores().data ?? []).filter((s) => s.isActive);
  const [storeParam, setStore] = useUrlParam("store", "");
  const [dateParam, setDate] = useUrlParam("date", "");
  const [view, setView] = useUrlParam("view", "day");
  const [resourceFilter, setResourceFilter] = useUrlParam("resource", "");
  const storeId = storeParam || stores[0]?.id || "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayLocal();
  const isWeek = view === "week";
  const days = isWeek ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i)) : [date];
  const [booking, setBooking] = useState<{ slot?: SlotPick; appointment?: AppointmentResponse } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const resourcesQuery = useQuery({
    queryKey: resourcesKey(activeCompanyId, storeId),
    queryFn: () => apiClient.listPosResources(activeCompanyId as string, storeId),
    enabled: !!activeCompanyId && !!storeId,
  });
  const resources = useMemo(() => (resourcesQuery.data ?? []).filter((r) => r.isActive), [resourcesQuery.data]);
  const from = utcFromLocal(days[0]);
  const to = utcFromLocal(addDays(days[days.length - 1], 1));
  const appointmentsQuery = useQuery({
    queryKey: ["posAppointments", activeCompanyId, storeId, from, to],
    queryFn: () => apiClient.listPosAppointments(activeCompanyId as string, storeId, from, to, undefined),
    enabled: !!activeCompanyId && !!storeId,
    placeholderData: keepPreviousData,
  });
  const appointments = useMemo(() => appointmentsQuery.data ?? [], [appointmentsQuery.data]);
  const opened = appointments.find((a) => a.id === openId) ?? null;

  // The hours shown: the widest the resources work, and any appointment outside them.
  const [dayStart, dayEnd] = useMemo(() => {
    let start = 8 * 60;
    let end = 20 * 60;
    const spans = resources.flatMap((r) => r.hours);
    if (spans.length > 0) {
      start = Math.min(...spans.map((h) => minutesOf(h.from)));
      end = Math.max(...spans.map((h) => minutesOf(h.to)));
    }
    for (const a of appointments) {
      start = Math.min(start, localMinutes(a.start));
      end = Math.max(end, Math.min(24 * 60, localMinutes(a.start) + durationOf(a)));
    }
    return [Math.floor(start / 60) * 60, Math.min(24 * 60, Math.ceil(end / 60) * 60)];
  }, [resources, appointments]);

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  const columns: { key: string; label: string; date: string; resource?: ResourceResponse }[] = isWeek
    ? days.map((d) => ({ key: d, date: d, label: intl.formatDate(new Date(`${d}T12:00:00Z`), { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }) }))
    : resources.map((r) => ({ key: r.id, date, label: r.name, resource: r }));
  const inColumn = (c: (typeof columns)[number]) =>
    appointments.filter((a) =>
      c.resource ? a.resourceId === c.resource.id && localDate(a.start) === c.date : localDate(a.start) === c.date && (!resourceFilter || a.resourceId === resourceFilter),
    );
  const slots = Array.from({ length: Math.max(0, (dayEnd - dayStart) / SLOT) }, (_, i) => dayStart + i * SLOT);
  const step = isWeek ? 7 : 1;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("svc.nav.appointments")}</CardTitle>
          <CardDescription>{t("svc.nav.appointments.description")}</CardDescription>
        </div>
        {canWrite("pos") && storeId && (
          <Button size="sm" onClick={() => setBooking({ slot: { date, time: "", resourceId: isWeek ? resourceFilter : "" } })}>
            <Plus className="size-4" />
            {t("svc.appt.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-56 flex-col gap-1">
            <Label htmlFor="appt-store">{t("pos.register.store")}</Label>
            <Select id="appt-store" value={storeId} onValueChange={setStore} placeholder={t("pos.register.store")} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="appt-date">{t("svc.appt.date")}</Label>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" aria-label={t("svc.appt.previous")} onClick={() => setDate(addDays(date, -step))}>
                <ChevronLeft className="size-4" />
              </Button>
              <Input id="appt-date" type="date" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <Button size="sm" variant="outline" aria-label={t("svc.appt.next")} onClick={() => setDate(addDays(date, step))}>
                <ChevronRight className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDate("")}>{t("svc.appt.today")}</Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="appt-view">{t("svc.appt.view")}</Label>
            <Select
              id="appt-view"
              value={isWeek ? "week" : "day"}
              onValueChange={setView}
              options={[{ value: "day", label: t("svc.appt.view.day") }, { value: "week", label: t("svc.appt.view.week") }]}
            />
          </div>
          {isWeek && (
            <div className="flex w-48 flex-col gap-1">
              <Label htmlFor="appt-resource">{t("svc.appt.resource")}</Label>
              <Select
                id="appt-resource"
                value={resourceFilter}
                onValueChange={setResourceFilter}
                options={[{ value: "", label: t("svc.appt.resource.all") }, ...resources.map((r) => ({ value: r.id, label: r.name }))]}
              />
            </div>
          )}
        </div>
        {appointmentsQuery.error && (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(appointmentsQuery.error, t("svc.appt.loadError"))}</AlertDescription>
          </Alert>
        )}
        {!storeId ? (
          <p className="text-sm text-muted-foreground">{t("svc.appt.noStore")}</p>
        ) : !isWeek && resources.length === 0 && !resourcesQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{t("svc.appt.noResources")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border" data-testid="appointments-calendar">
            <div className="grid min-w-max" style={{ gridTemplateColumns: `4rem repeat(${columns.length}, minmax(10rem, 1fr))` }}>
              <div className="sticky left-0 z-10 border-b bg-background" />
              {columns.map((c) => (
                <div key={c.key} className="flex items-center gap-2 border-b border-l px-2 py-1.5 text-sm font-medium">
                  {c.resource?.color && <span className="inline-block size-3 rounded-full" style={{ backgroundColor: c.resource.color }} />}
                  {c.label}
                </div>
              ))}
              <div className="sticky left-0 z-10 bg-background" style={{ height: (dayEnd - dayStart) * PX_PER_MIN }}>
                {slots.filter((m) => m % 60 === 0).map((m) => (
                  <span key={m} className="absolute right-1 -translate-y-1/2 text-xs text-muted-foreground tabular-nums" style={{ top: (m - dayStart) * PX_PER_MIN }}>
                    {timeOf(m)}
                  </span>
                ))}
              </div>
              {columns.map((c) => (
                <div key={c.key} className="relative border-l" style={{ height: (dayEnd - dayStart) * PX_PER_MIN }}>
                  {slots.map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={!canWrite("pos")}
                      aria-label={t("svc.appt.bookSlot", { column: c.label, time: timeOf(m) })}
                      className={cn("absolute inset-x-0 border-t hover:bg-accent/60", m % 60 !== 0 && "border-dashed border-muted")}
                      style={{ top: (m - dayStart) * PX_PER_MIN, height: SLOT * PX_PER_MIN }}
                      onClick={() => setBooking({ slot: { date: c.date, time: timeOf(m), resourceId: c.resource?.id ?? resourceFilter } })}
                    />
                  ))}
                  {inColumn(c).map((a) => {
                    const top = (localMinutes(a.start) - dayStart) * PX_PER_MIN;
                    const resource = resources.find((r) => r.id === a.resourceId);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        data-testid="appointment-block"
                        onClick={() => setOpenId(a.id)}
                        className={cn("absolute inset-x-1 z-[1] overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-left text-xs shadow-sm", STATE_CLASS[a.state])}
                        style={{ top, height: Math.max(18, durationOf(a) * PX_PER_MIN - 2), borderLeftColor: resource?.color ?? undefined }}
                        title={`${localTime(a.start)}–${localTime(a.end)} ${a.customerName} · ${a.serviceName}`}
                      >
                        <span className="flex items-center gap-1 font-medium">
                          <span className="tabular-nums">{localTime(a.start)}</span> {a.customerName}
                          {a.source === AppointmentSource.Online && <Globe className="size-3" aria-label={t("svc.appt.online")} />}
                        </span>
                        <span className="block truncate">{a.serviceName}{isWeek ? ` · ${a.resourceName}` : ""}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          {[AppointmentState.Booked, AppointmentState.Confirmed, AppointmentState.CheckedIn, AppointmentState.Completed, AppointmentState.NoShow, AppointmentState.Cancelled].map((s) => (
            <span key={s} className={cn("rounded border-l-4 px-1.5 py-0.5", STATE_CLASS[s])}>{t(`svc.appt.state.${appointmentStateKey(s)}`)}</span>
          ))}
        </div>
      </CardContent>
      {booking && (
        <BookingDialog
          storeId={storeId}
          resources={resources}
          slot={booking.slot}
          appointment={booking.appointment}
          onClose={() => setBooking(null)}
          onSaved={(saved) => {
            setBooking(null);
            setOpenId(saved.id);
          }}
        />
      )}
      {opened && !booking && (
        <AppointmentDialog
          appointment={opened}
          onClose={() => setOpenId(null)}
          onReschedule={() => setBooking({ appointment: opened })}
        />
      )}
    </Card>
  );
}

function durationOf(a: AppointmentResponse) {
  return Math.max(SLOT / 2, Math.round((parseUtc(a.end).getTime() - parseUtc(a.start).getTime()) / 60_000));
}

export function BookingDialog({ storeId, resources, slot, appointment, onClose, onSaved }: {
  storeId: string;
  resources: ResourceResponse[];
  slot?: SlotPick;
  appointment?: AppointmentResponse;
  onClose: () => void;
  onSaved: (saved: AppointmentResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const itemSearch = useItemSearch();
  const customers = (useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []).filter((p) => p.isCustomer || p.id === appointment?.customerId);

  const [itemId, setItemId] = useState(appointment?.itemId ?? "");
  const [date, setDate] = useState(appointment ? localDate(appointment.start) : slot?.date ?? todayLocal());
  const [resourceId, setResourceId] = useState(appointment?.resourceId ?? slot?.resourceId ?? "");
  const [time, setTime] = useState(appointment ? localTime(appointment.start) : slot?.time ?? "");
  const [customerId, setCustomerId] = useState(appointment?.customerId ?? "");
  const [name, setName] = useState(appointment?.customerName ?? "");
  const [phone, setPhone] = useState(appointment?.phone ?? "");
  const [email, setEmail] = useState(appointment?.email ?? "");
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  // The services the store's resources perform.
  const performed = new Set(resources.flatMap((r) => r.serviceItemIds));
  const serviceOptions = useMemo(() => {
    const options = itemSearch.items
      .filter((i) => i.isBookable && performed.has(i.id))
      .map((i) => ({ value: i.id, label: i.name, description: i.durationMinutes ? t("svc.minutes", { n: i.durationMinutes }) : undefined }));
    if (appointment && !options.some((o) => o.value === appointment.itemId)) options.unshift({ value: appointment.itemId, label: appointment.serviceName, description: undefined });
    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSearch.items, resources, appointment]);
  const resourceOptions = resources.filter((r) => !itemId || r.serviceItemIds.includes(itemId) || r.id === appointment?.resourceId);

  const availability = useQuery({
    queryKey: ["posAvailability", activeCompanyId, storeId, itemId, date],
    queryFn: () => apiClient.getPosAvailability(activeCompanyId as string, storeId, itemId, date, undefined),
    enabled: !!activeCompanyId && !!storeId && !!itemId && !!date,
    retry: false,
  });
  const offered = (availability.data?.resources ?? []).filter((r) => !resourceId || r.resourceId === resourceId);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        storeId, itemId, resourceId, start: utcFromLocal(date, time), customerName: name.trim(), customerId: customerId || undefined,
        phone: phone.trim() || undefined, email: email.trim() || undefined, notes: notes.trim() || undefined,
      };
      return appointment
        ? apiClient.updatePosAppointment(activeCompanyId as string, appointment.id, body)
        : apiClient.createPosAppointment(activeCompanyId as string, body);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["posAppointments", activeCompanyId] });
      onSaved(saved);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const valid = !!itemId && !!resourceId && !!date && /^\d{2}:\d{2}$/.test(time) && !!name.trim();

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={appointment ? t("svc.appt.reschedule.title", { number: appointment.number }) : t("svc.appt.new")}
      size="lg"
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="bk-service">{t("svc.appt.service")}</Label>
            <SearchableSelect
              id="bk-service"
              value={itemId}
              onChange={setItemId}
              onSearchChange={itemSearch.onSearchChange}
              placeholder={t("svc.appt.service.pick")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("svc.appt.service.none")}
              options={serviceOptions}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-date">{t("svc.appt.date")}</Label>
            <Input id="bk-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-resource">{t("svc.appt.resource")}</Label>
            <Select
              id="bk-resource"
              value={resourceId}
              onValueChange={setResourceId}
              placeholder={t("svc.appt.resource.pick")}
              options={resourceOptions.map((r) => ({ value: r.id, label: r.name }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-time">{t("svc.appt.time")}</Label>
            <Input id="bk-time" type="time" step={300} required value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        {itemId && (
          <div className="flex flex-col gap-2 rounded-md border p-2" data-testid="availability">
            <p className="text-sm font-medium">{t("svc.appt.free")}</p>
            {availability.isPending && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
            {availability.error && <p className="text-sm text-destructive">{getApiErrorMessage(availability.error, t("svc.appt.loadError"))}</p>}
            {availability.data && offered.every((r) => r.starts.length === 0) && <p className="text-sm text-muted-foreground">{t("svc.appt.free.none")}</p>}
            {offered.filter((r) => r.starts.length > 0).map((r) => (
              <div key={r.resourceId} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{r.name}</span>
                <div className="flex flex-wrap gap-1">
                  {r.starts.map((s) => {
                    const at = localTime(s);
                    const chosen = resourceId === r.resourceId && time === at;
                    return (
                      <Button
                        key={s}
                        type="button"
                        size="xs"
                        variant={chosen ? "default" : "outline"}
                        className="tabular-nums"
                        aria-pressed={chosen}
                        aria-label={t("svc.appt.free.pick", { resource: r.name, time: at })}
                        onClick={() => {
                          setResourceId(r.resourceId);
                          setTime(at);
                        }}
                      >
                        {at}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-customer">{t("svc.appt.partner")}</Label>
            <SearchableSelect
              id="bk-customer"
              value={customerId}
              onChange={(v) => {
                setCustomerId(v);
                const partner = customers.find((p) => p.id === v);
                if (partner && !name.trim()) setName(partner.name);
              }}
              placeholder={t("svc.appt.partner.none")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              emptyOptionLabel={t("svc.appt.partner.none")}
              options={customers.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-name">{t("svc.appt.customerName")}</Label>
            <Input id="bk-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-phone">{t("svc.phone")}</Label>
            <Input id="bk-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-email">{t("svc.email")}</Label>
            <Input id="bk-email" type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="bk-notes">{t("svc.notes")}</Label>
          <Textarea id="bk-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{appointment ? t("common.save") : t("svc.appt.book")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function AppointmentDialog({ appointment: a, onClose, onReschedule }: { appointment: AppointmentResponse; onClose: () => void; onReschedule: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const registers = usePosRegisters().data ?? [];
  const till = pickTillRegister(registers, a.storeId);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [depositCard, setDepositCard] = useState<string | null>(a.depositCardNumber ?? null);
  const closed = isClosed(a);
  const write = canWrite("pos");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["posAppointments", activeCompanyId] });
  const setState = useMutation({
    mutationFn: (body: { state: number; reason?: string }) => apiClient.setPosAppointmentState(activeCompanyId as string, a.id, body),
    onSuccess: async () => {
      setError(null);
      setCancelling(false);
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const deposit = useMutation({
    mutationFn: () => apiClient.getPosAppointmentDepositCard(activeCompanyId as string, a.id),
    onSuccess: async (updated) => {
      setError(null);
      setDepositCard(updated.depositCardNumber ?? null);
      await refresh();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  const goTill = (query: string) => {
    if (!till) {
      setError(t("svc.noTill"));
      return;
    }
    navigate(`/pos/till/${till.id}?${query}`);
  };

  const busy = setState.isPending || deposit.isPending;
  const canMark = write && !closed;

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={`${a.number} · ${a.customerName}`} size="md">
      <div className="flex flex-col gap-3" data-testid="appointment-details">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={a.state === AppointmentState.Cancelled || a.state === AppointmentState.NoShow ? "secondary" : "default"}>
            {t(`svc.appt.state.${appointmentStateKey(a.state)}`)}
          </Badge>
          {a.source === AppointmentSource.Online && <Badge variant="outline">{t("svc.appt.online")}</Badge>}
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("svc.appt.service")}</dt>
          <dd>{a.serviceName}</dd>
          <dt className="text-muted-foreground">{t("svc.appt.resource")}</dt>
          <dd>{a.resourceName}</dd>
          <dt className="text-muted-foreground">{t("svc.appt.when")}</dt>
          <dd className="tabular-nums">{localDate(a.start)} {localTime(a.start)}–{localTime(a.end)}</dd>
          {a.phone && (<><dt className="text-muted-foreground">{t("svc.phone")}</dt><dd>{a.phone}</dd></>)}
          {a.email && (<><dt className="text-muted-foreground">{t("svc.email")}</dt><dd>{a.email}</dd></>)}
          {a.notes && (<><dt className="text-muted-foreground">{t("svc.notes")}</dt><dd className="whitespace-pre-wrap">{a.notes}</dd></>)}
          {a.price != null && (<><dt className="text-muted-foreground">{t("svc.appt.price")}</dt><dd className="tabular-nums">{money(a.price)}</dd></>)}
          <dt className="text-muted-foreground">{t("svc.appt.deposited")}</dt>
          <dd className="tabular-nums">{money(a.deposited)}</dd>
        </dl>

        {depositCard && !closed && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm" data-testid="deposit-card">
            <span>{t("svc.appt.depositCard", { number: depositCard })}</span>
            {write && (
              <Button size="sm" variant="outline" onClick={() => goTill(`giftCard=${encodeURIComponent(depositCard)}`)}>
                {t("svc.appt.depositAtTill")}
              </Button>
            )}
            <p className="w-full text-xs text-muted-foreground">{t("svc.appt.depositCard.hint")}</p>
          </div>
        )}

        {cancelling ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setState.mutate({ state: AppointmentState.Cancelled, reason: reason.trim() });
            }}
          >
            <Label htmlFor="appt-cancel-reason">{t("till.return.reason")}</Label>
            <Input id="appt-cancel-reason" required autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCancelling(false)}>{t("common.cancel")}</Button>
              <Button type="submit" variant="destructive" disabled={!reason.trim() || busy}>{t("svc.appt.cancel")}</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {canMark && (
              <Button size="sm" variant="outline" onClick={onReschedule} disabled={busy}>{t("svc.appt.reschedule")}</Button>
            )}
            {canMark && a.state === AppointmentState.Booked && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setState.mutate({ state: AppointmentState.Confirmed })}>{t("svc.appt.confirm")}</Button>
            )}
            {canMark && (a.state === AppointmentState.Booked || a.state === AppointmentState.Confirmed) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setState.mutate({ state: AppointmentState.CheckedIn })}>{t("svc.appt.checkIn")}</Button>
            )}
            {canMark && (a.state === AppointmentState.Booked || a.state === AppointmentState.Confirmed) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setState.mutate({ state: AppointmentState.NoShow })}>{t("svc.appt.noShow")}</Button>
            )}
            {canMark && !depositCard && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => deposit.mutate()}>{t("svc.appt.takeDeposit")}</Button>
            )}
            {canMark && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelling(true)}>{t("svc.appt.cancel")}</Button>
            )}
            {canMark && a.state !== AppointmentState.NoShow && (
              <Button size="sm" disabled={busy} onClick={() => goTill(`appointment=${a.id}&on=${localDate(a.start)}`)}>{t("svc.appt.checkout")}</Button>
            )}
          </div>
        )}
      </div>
    </FormDialog>
  );
}
