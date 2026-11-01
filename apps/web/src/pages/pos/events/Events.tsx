import { forwardRef, useMemo, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { EventBookingResponse, SaveEventBookingRequest, TabResponse, VenueResponse } from "@pako/shared";
import { CheckCircle2, ChevronLeft, ChevronRight, CreditCard, Pencil, Plus, Printer, Users, Wallet, X } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useItemLookup } from "@/hooks/useItemLookup";
import { useMyAccess } from "@/hooks/useMyAccess";
import { usePosStores } from "@/hooks/usePos";
import { useUrlParam } from "@/hooks/useUrlParam";
import { EventBookingState, eventBookingStateKey } from "@/lib/pos-enums";
import { printElement } from "@/lib/print";
import { ItemPicker } from "@/pages/pos/menuPickers";
import { ConfirmDialog, DepositCardNote, ErrorAlert, Field, FolioView } from "@/pages/pos/hotel/hotel-shared";
import { EVENT_BADGE, isIsoDate, isoDate, money, parseIso, shortTime, tabKey, tabTillUrl, useTabTill } from "@/pages/pos/hotel/hotel-utils";

const ALL = "all";
const eventsKey = (companyId: string | null) => ["posEventBookings", companyId] as const;
const venuesKey = (companyId: string | null) => ["posVenues", companyId] as const;

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) };
}
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const toWireTime = (v: string) => (v ? (v.length === 5 ? `${v}:00` : v) : undefined);

// docs/POS_PLAN.md §6.5 / P5: wedding halls and event venues — the halls, and a month of bookings
// per hall: packages priced per guest, deposits on a deposit card, the final headcount that opens
// the bill (a tab the till adds extras to and takes payment on), and the banquet event order.
export function Events() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const queryClient = useQueryClient();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [monthParam, setMonth] = useUrlParam("month", thisMonth);
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : thisMonth;
  const [venueId, setVenueId] = useUrlParam("venue", ALL);
  const [eventId, setEventId] = useUrlParam("event");
  const [editing, setEditing] = useState<EventBookingResponse | "new" | null>(null);
  const [addingVenue, setAddingVenue] = useState(false);
  const stores = usePosStores().data ?? [];

  const venuesQuery = useQuery({
    queryKey: venuesKey(activeCompanyId),
    queryFn: () => apiClient.listPosVenues(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
  const venues = useMemo(() => venuesQuery.data ?? [], [venuesQuery.data]);
  const { from, to } = monthRange(month);
  const eventsQuery = useQuery({
    queryKey: [...eventsKey(activeCompanyId), from, to, venueId],
    queryFn: () => apiClient.listPosEventBookings(activeCompanyId as string, from, to, venueId === ALL ? undefined : venueId),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const selected = events.find((e) => e.id === eventId);

  const venueColumns = useMemo<ColumnDef<VenueResponse>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("hotel.venue.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.name}
            {!row.original.isActive && <Badge variant="secondary">{t("common.inactive")}</Badge>}
          </span>
        ),
      },
      { id: "store", header: t("pos.register.store"), accessorFn: (v) => stores.find((s) => s.id === v.storeId)?.name ?? "" },
      { accessorKey: "capacity", header: t("hotel.venue.capacity"), meta: { numeric: true } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, stores],
  );
  const eventColumns = useMemo<ColumnDef<EventBookingResponse>[]>(
    () => [
      { id: "date", header: t("hotel.event.date"), accessorFn: (e) => e.date, cell: ({ row }) => intl.formatDate(parseIso(row.original.date), { weekday: "short", day: "numeric", month: "short" }) },
      { id: "time", header: t("hotel.event.time"), accessorFn: (e) => [shortTime(e.from), shortTime(e.to)].filter(Boolean).join("–") },
      { accessorKey: "venueName", header: t("hotel.venue") },
      { accessorKey: "customerName", header: t("hotel.event.customer") },
      { accessorKey: "number", header: t("hotel.booking.number") },
      { accessorKey: "guestsEstimated", header: t("hotel.event.guestsEstimated"), meta: { numeric: true } },
      { id: "guestsFinal", header: t("hotel.event.guestsFinal"), meta: { numeric: true }, accessorFn: (e) => e.guestsFinal ?? "" },
      { accessorKey: "deposited", header: t("hotel.event.deposited"), meta: { numeric: true }, cell: ({ getValue }) => money(getValue() as number) },
      {
        id: "state",
        header: t("hotel.booking.state"),
        accessorFn: (e) => t(`hotel.eventState.${eventBookingStateKey(e.state)}`),
        cell: ({ row, getValue }) => <Badge variant={EVENT_BADGE[row.original.state] ?? "outline"}>{getValue() as string}</Badge>,
      },
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
            <CardTitle>{t("hotel.nav.events")}</CardTitle>
            <CardDescription>{t("hotel.nav.events.description")}</CardDescription>
          </div>
          {canWrite("pos") && venues.some((v) => v.isActive) && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" /> {t("hotel.event.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ev-month">{t("hotel.event.month")}</Label>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" aria-label={t("hotel.period.prev")} onClick={() => setMonth(shiftMonth(month, -1))}>
                  <ChevronLeft className="size-4" />
                </Button>
                <Input id="ev-month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
                <Button size="sm" variant="outline" aria-label={t("hotel.period.next")} onClick={() => setMonth(shiftMonth(month, 1))}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex w-56 flex-col gap-1">
              <Label htmlFor="ev-venue">{t("hotel.venue")}</Label>
              <Select
                id="ev-venue"
                value={venueId}
                onValueChange={setVenueId}
                options={[{ value: ALL, label: t("hotel.venue.all") }, ...venues.map((v) => ({ value: v.id, label: v.name }))]}
              />
            </div>
          </div>
          {eventsQuery.error && <ErrorAlert message={getApiErrorMessage(eventsQuery.error, t("pos.saveError"))} />}
          <DataGrid
            gridId="pos-events"
            columns={eventColumns}
            data={events}
            rowCount={events.length}
            isLoading={eventsQuery.isPending}
            getRowId={(e) => e.id}
            getRowClassName={(e) => (e.state === EventBookingState.Cancelled ? "text-muted-foreground line-through" : e.state === EventBookingState.Completed ? "text-muted-foreground" : undefined)}
            onRowClick={(e) => setEventId(e.id)}
            emptyMessage={t("hotel.event.empty")}
            exportFileName="events"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("hotel.venues")}</CardTitle>
            <CardDescription>{t("hotel.venues.description")}</CardDescription>
          </div>
          {canApprove("pos") && stores.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setAddingVenue(true)}>
              <Plus className="size-4" /> {t("hotel.venue.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-venues"
            columns={venueColumns}
            data={venues}
            rowCount={venues.length}
            isLoading={venuesQuery.isPending}
            getRowId={(v) => v.id}
            emptyMessage={t("hotel.venue.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      {editing && (
        <EventFormDialog
          venues={venues}
          booking={editing === "new" ? undefined : editing}
          defaultVenueId={venueId === ALL ? undefined : venueId}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: eventsKey(activeCompanyId) });
            if (saved.date.slice(0, 7) !== month) setMonth(saved.date.slice(0, 7));
            setEventId(saved.id);
          }}
        />
      )}
      {selected && !editing && (
        <EventDetailsDialog key={selected.id} booking={selected} onEdit={() => setEditing(selected)} onClose={() => setEventId("")} />
      )}
      {addingVenue && (
        <VenueDialog
          onClose={() => setAddingVenue(false)}
          onSaved={async () => {
            setAddingVenue(false);
            await queryClient.invalidateQueries({ queryKey: venuesKey(activeCompanyId) });
          }}
        />
      )}
    </div>
  );
}

function VenueDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const stores = (usePosStores().data ?? []).filter((s) => s.isActive);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("100");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiClient.createPosVenue(activeCompanyId as string, { storeId, name: name.trim(), capacity: Number(capacity), isActive }),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const valid = !!storeId && !!name.trim() && /^\d{1,5}$/.test(capacity.trim()) && Number(capacity) >= 1;
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={t("hotel.venue.new")} size="sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (valid) save.mutate();
        }}
      >
        <ErrorAlert message={error} />
        <Field id="venue-store" label={t("pos.register.store")}>
          <Select id="venue-store" value={storeId} onValueChange={setStoreId} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field id="venue-name" label={t("hotel.venue.name")}>
            <Input id="venue-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="venue-capacity" label={t("hotel.venue.capacity")}>
            <Input id="venue-capacity" inputMode="numeric" className="text-right tabular-nums" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("common.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function EventFormDialog({ venues, booking, defaultVenueId, onClose, onSaved }: {
  venues: VenueResponse[];
  booking?: EventBookingResponse;
  defaultVenueId?: string;
  onClose: () => void;
  onSaved: (saved: EventBookingResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const customers = (useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? []).filter((p) => p.isCustomer || p.id === booking?.customerId);
  const active = venues.filter((v) => v.isActive || v.id === booking?.venueId);
  const [venueId, setVenueId] = useState(booking?.venueId ?? defaultVenueId ?? active[0]?.id ?? "");
  const [date, setDate] = useState(booking?.date ?? isoDate(new Date()));
  const [from, setFrom] = useState(shortTime(booking?.from));
  const [to, setTo] = useState(shortTime(booking?.to));
  const [customerId, setCustomerId] = useState(booking?.customerId ?? "");
  const [customerName, setCustomerName] = useState(booking?.customerName ?? "");
  const [phone, setPhone] = useState(booking?.phone ?? "");
  const [guests, setGuests] = useState(String(booking?.guestsEstimated ?? ""));
  const [packageItemId, setPackageItemId] = useState(booking?.packageItemId ?? "");
  const [price, setPrice] = useState(booking?.pricePerGuest != null ? String(booking.pricePerGuest) : "");
  const [banquetNotes, setBanquetNotes] = useState(booking?.banquetNotes ?? "");
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const lookup = useItemLookup([packageItemId]);
  const venue = venues.find((v) => v.id === venueId);

  const save = useMutation({
    mutationFn: () => {
      const body: SaveEventBookingRequest = {
        storeId: venue?.storeId as string,
        venueId,
        date,
        customerName: customerName.trim(),
        guestsEstimated: Number(guests),
        from: toWireTime(from),
        to: toWireTime(to),
        customerId: customerId || undefined,
        phone: phone.trim() || undefined,
        packageItemId: packageItemId || undefined,
        // Empty: the package item's own price.
        pricePerGuest: price.trim() ? Number(price) : undefined,
        banquetNotes: banquetNotes.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      return booking
        ? apiClient.updatePosEventBooking(activeCompanyId as string, booking.id, body)
        : apiClient.createPosEventBooking(activeCompanyId as string, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const valid = !!venue && isIsoDate(date) && !!customerName.trim() && /^\d{1,5}$/.test(guests.trim()) && Number(guests) >= 1 &&
    (!from || !to || to > from) && (price.trim() === "" || Number(price) >= 0);

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={booking ? t("hotel.booking.editTitle", { number: booking.number }) : t("hotel.event.new")}
      size="lg"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (valid) save.mutate();
        }}
      >
        <ErrorAlert message={error} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Field id="ev-f-venue" label={t("hotel.venue")}>
            <Select
              id="ev-f-venue"
              value={venueId}
              onValueChange={setVenueId}
              options={active.map((v) => ({ value: v.id, label: `${v.name} · ${t("hotel.roomType.capacityN", { count: v.capacity })}` }))}
            />
          </Field>
          <Field id="ev-f-date" label={t("hotel.event.date")}>
            <Input id="ev-f-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="ev-f-from" label={t("hotel.event.from")}>
            <Input id="ev-f-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field id="ev-f-to" label={t("hotel.event.to")}>
            <Input id="ev-f-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="ev-f-partner" label={t("hotel.event.customerPartner")}>
            <SearchableSelect
              id="ev-f-partner"
              value={customerId}
              onChange={(v) => {
                setCustomerId(v);
                const p = customers.find((x) => x.id === v);
                if (p && !customerName.trim()) setCustomerName(p.name);
              }}
              emptyOptionLabel={t("hotel.event.customerPartner.none")}
              placeholder={t("hotel.event.customerPartner.none")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              options={customers.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
            />
          </Field>
          <Field id="ev-f-customer" label={t("hotel.event.customer")}>
            <Input id="ev-f-customer" maxLength={120} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </Field>
          <Field id="ev-f-phone" label={t("hotel.booking.phone")}>
            <Input id="ev-f-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_9rem]">
          <Field id="ev-f-guests" label={t("hotel.event.guestsEstimated")}>
            <Input id="ev-f-guests" inputMode="numeric" className="text-right tabular-nums" value={guests} onChange={(e) => setGuests(e.target.value)} />
          </Field>
          <Field id="ev-f-package" label={t("hotel.event.package")}>
            <ItemPicker id="ev-f-package" lookup={lookup} value={packageItemId} onChange={setPackageItemId} label={t("hotel.event.package")} />
          </Field>
          <Field id="ev-f-price" label={t("hotel.event.pricePerGuest")}>
            <Input
              id="ev-f-price"
              type="number"
              min={0}
              step="0.01"
              className="text-right tabular-nums"
              placeholder={t("hotel.event.pricePerGuest.placeholder")}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
        </div>
        <Field id="ev-f-beo" label={t("hotel.event.banquetNotes")}>
          <Textarea id="ev-f-beo" rows={4} maxLength={4000} placeholder={t("hotel.event.banquetNotes.placeholder")} value={banquetNotes} onChange={(e) => setBanquetNotes(e.target.value)} />
        </Field>
        <Field id="ev-f-notes" label={t("hotel.booking.notes")}>
          <Textarea id="ev-f-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

function EventDetailsDialog({ booking: listed, onEdit, onClose }: { booking: EventBookingResponse; onEdit: () => void; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const { canWrite } = useMyAccess();
  const writable = canWrite("pos");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The latest answer from the server wins over the month's list until the list refreshes.
  const [latest, setLatest] = useState<EventBookingResponse | null>(null);
  const booking = latest ?? listed;
  const [billTabId, setBillTabId] = useState<string | undefined>(booking.tabId);
  const tabId = booking.tabId ?? billTabId;
  const [guests, setGuests] = useState(String(booking.guestsFinal ?? booking.guestsEstimated));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beoRef = useRef<HTMLDivElement>(null);
  const lookup = useItemLookup([booking.packageItemId]);
  const till = useTabTill(booking.storeId);
  const bill = useQuery({
    queryKey: tabKey(companyId, tabId ?? ""),
    queryFn: () => apiClient.getPosTab(companyId, tabId as string),
    enabled: !!activeCompanyId && !!tabId,
  });

  const fail = (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError")));
  const refreshList = () => queryClient.invalidateQueries({ queryKey: eventsKey(companyId) });
  function bookingDone(next: EventBookingResponse) {
    setError(null);
    setLatest(next);
    void refreshList();
  }
  const setState = useMutation({
    mutationFn: (state: number) => apiClient.setPosEventBookingState(companyId, booking.id, { state }),
    onSuccess: bookingDone,
    onError: fail,
    onSettled: () => setConfirmCancel(false),
  });
  const deposit = useMutation({ mutationFn: () => apiClient.getPosEventDepositCard(companyId, booking.id), onSuccess: bookingDone, onError: fail });
  const finalGuests = useMutation({
    mutationFn: () => apiClient.setPosEventFinalGuests(companyId, booking.id, { guests: Number(guests) }),
    onSuccess: (tab: TabResponse) => {
      setError(null);
      queryClient.setQueryData(tabKey(companyId, tab.id), tab);
      setBillTabId(tab.id);
      setLatest({ ...booking, tabId: tab.id, guestsFinal: Number(guests) });
      void refreshList();
    },
    onError: fail,
  });
  const busy = setState.isPending || deposit.isPending || finalGuests.isPending;
  const open = booking.state === EventBookingState.Tentative || booking.state === EventBookingState.Confirmed;
  const packageName = booking.packageItemId ? lookup.find(booking.packageItemId)?.name ?? "…" : undefined;

  return (
    <FormDialog open onOpenChange={(o) => !o && !busy && onClose()} title={`${booking.number} · ${booking.customerName}`} size="lg">
      <div className="flex flex-col gap-3" data-testid="event-details">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={EVENT_BADGE[booking.state] ?? "outline"} data-testid="event-state">{t(`hotel.eventState.${eventBookingStateKey(booking.state)}`)}</Badge>
          <span>{booking.venueName}</span>
          <span className="tabular-nums">
            {intl.formatDate(parseIso(booking.date), { dateStyle: "full" })}
            {booking.from ? ` · ${shortTime(booking.from)}` : ""}
            {booking.to ? `–${shortTime(booking.to)}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {booking.phone && <span>{booking.phone}</span>}
          <span>{t("hotel.event.guestsN", { estimated: booking.guestsEstimated, final: booking.guestsFinal ?? "—" })}</span>
          {packageName && <span>{t("hotel.event.package")}: {packageName}</span>}
          {booking.pricePerGuest != null && <span className="tabular-nums">{t("hotel.event.pricePerGuestN", { amount: money(booking.pricePerGuest) })}</span>}
        </div>
        {booking.banquetNotes && (
          <div className="rounded-md border bg-muted/40 p-2 text-sm">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{t("hotel.event.banquetNotes")}</p>
            <p className="whitespace-pre-line">{booking.banquetNotes}</p>
          </div>
        )}
        {booking.notes && <p className="whitespace-pre-line text-sm">{booking.notes}</p>}
        <ErrorAlert message={error} />
        <DepositCardNote number={booking.depositCardNumber} deposited={booking.deposited} />

        {tabId && (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t("hotel.event.bill")}</h3>
            {bill.data ? <FolioView tab={bill.data} /> : <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
          </section>
        )}

        {writable && open && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field id="ev-final" label={t("hotel.event.finalHeadcount")}>
                <Input id="ev-final" inputMode="numeric" className="w-28 text-right tabular-nums" value={guests} onChange={(e) => setGuests(e.target.value)} />
              </Field>
              <Button
                variant="outline"
                disabled={busy || !/^\d{1,5}$/.test(guests.trim()) || Number(guests) < 1 || !booking.packageItemId}
                onClick={() => finalGuests.mutate()}
              >
                <Users className="size-4" /> {t("hotel.event.setFinal")}
              </Button>
              {!booking.packageItemId && <span className="text-xs text-muted-foreground">{t("hotel.event.noPackage")}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
                <Pencil className="size-4" /> {t("hotel.booking.edit")}
              </Button>
              {booking.state === EventBookingState.Tentative && (
                <Button size="sm" disabled={busy} onClick={() => setState.mutate(EventBookingState.Confirmed)}>
                  <CheckCircle2 className="size-4" /> {t("hotel.event.confirm")}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => deposit.mutate()}>
                <CreditCard className="size-4" /> {t("hotel.deposit.get")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !tabId || !till} onClick={() => till && tabId && navigate(tabTillUrl(till.id, tabId))}>
                <Wallet className="size-4" /> {t("hotel.event.openBill")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !tabId} onClick={() => setState.mutate(EventBookingState.Completed)}>
                <CheckCircle2 className="size-4" /> {t("hotel.event.complete")}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>
                <X className="size-4" /> {t("hotel.event.cancel")}
              </Button>
            </div>
            {tabId && !till && <span className="text-xs text-muted-foreground">{t("hotel.till.none")}</span>}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => printElement(beoRef.current as HTMLElement)}>
            <Printer className="size-4" /> {t("hotel.event.printBeo")}
          </Button>
        </div>
        <div className="hidden">
          <BeoSheet ref={beoRef} booking={booking} packageName={packageName} />
        </div>
      </div>
      {confirmCancel && (
        <ConfirmDialog
          title={t("hotel.event.cancel.title", { number: booking.number })}
          body={t("hotel.event.cancel.body")}
          confirm={t("hotel.event.cancel")}
          busy={setState.isPending}
          onConfirm={() => setState.mutate(EventBookingState.Cancelled)}
          onClose={() => setConfirmCancel(false)}
        />
      )}
    </FormDialog>
  );
}

// The banquet event order: what the kitchen and the floor need to run the event, on one A4 page.
const BeoSheet = forwardRef<HTMLDivElement, { booking: EventBookingResponse; packageName: string | undefined }>(function BeoSheet({ booking, packageName }, ref) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const row = (label: string, value: string | number | undefined) => (
    <div className="flex gap-2 border-b border-black/30 py-1">
      <span className="w-48 shrink-0 font-semibold">{label}</span>
      <span className="whitespace-pre-line">{value ?? "—"}</span>
    </div>
  );
  return (
    <div ref={ref} className="bg-white p-4 text-[12pt] text-black" data-testid="beo-sheet">
      <h1 className="mb-1 text-xl font-bold">{t("hotel.beo.title")}</h1>
      <p className="mb-3">{booking.number} · {booking.venueName}</p>
      {row(t("hotel.event.date"), intl.formatDate(parseIso(booking.date), { dateStyle: "full" }))}
      {row(t("hotel.event.time"), [shortTime(booking.from), shortTime(booking.to)].filter(Boolean).join(" – ") || undefined)}
      {row(t("hotel.event.customer"), booking.customerName)}
      {row(t("hotel.booking.phone"), booking.phone)}
      {row(t("hotel.event.guestsEstimated"), booking.guestsEstimated)}
      {row(t("hotel.event.guestsFinal"), booking.guestsFinal)}
      {row(t("hotel.event.package"), packageName)}
      {row(t("hotel.event.pricePerGuest"), booking.pricePerGuest != null ? money(booking.pricePerGuest) : undefined)}
      <h2 className="mt-4 mb-1 font-bold">{t("hotel.event.banquetNotes")}</h2>
      <p className="min-h-40 whitespace-pre-line border border-black p-2">{booking.banquetNotes ?? ""}</p>
      {booking.notes && (
        <>
          <h2 className="mt-4 mb-1 font-bold">{t("hotel.booking.notes")}</h2>
          <p className="whitespace-pre-line">{booking.notes}</p>
        </>
      )}
      <div className="mt-10 grid grid-cols-2 gap-10">
        <p className="border-t border-black pt-1">{t("hotel.beo.signCustomer")}</p>
        <p className="border-t border-black pt-1">{t("hotel.beo.signVenue")}</p>
      </div>
    </div>
  );
});
