import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HotelBookingResponse, HotelGuestResponse, SaveHotelBookingRequest, TabResponse } from "@pako/shared";
import { BedDouble, CreditCard, FileText, LogIn, LogOut, Moon, Pencil, Plus, Receipt, Wallet, X } from "lucide-react";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { HotelBookingState, hotelBookingStateKey } from "@/lib/pos-enums";
import { ConfirmDialog, DepositCardNote, ErrorAlert, Field, FolioView } from "@/pages/pos/hotel/hotel-shared";
import {
  BOOKING_BADGE, addDays, hotelBookingKey, hotelCalendarKey, isIsoDate, isoDate, money, roomTypesKey, tabKey, tabTillUrl, useTabTill,
} from "@/pages/pos/hotel/hotel-utils";

const NO_ROOM = "none";


function useCustomers() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
  }).data ?? [];
}

// ---- New booking / edit booking ----

export function BookingFormDialog({ storeId, booking, defaults, onClose, onSaved }: {
  storeId: string;
  booking?: HotelBookingResponse;
  /** A new booking's room and arrival, when started from a cell of the chart. */
  defaults?: { roomTypeId?: string; roomId?: string; arrival?: string };
  onClose: () => void;
  onSaved: (booking: HotelBookingResponse) => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const types = useQuery({
    queryKey: roomTypesKey(activeCompanyId, storeId),
    queryFn: () => apiClient.listPosRoomTypes(activeCompanyId as string, storeId),
    enabled: !!activeCompanyId && !!storeId,
  }).data ?? [];
  const customers = useCustomers().filter((p) => p.isCustomer || p.id === booking?.companyPartnerId);

  const today = isoDate(new Date());
  const [roomTypeId, setRoomTypeId] = useState(booking?.roomTypeId ?? defaults?.roomTypeId ?? "");
  const [arrival, setArrival] = useState(booking?.arrival ?? defaults?.arrival ?? today);
  const [departure, setDeparture] = useState(booking?.departure ?? addDays(defaults?.arrival ?? today, 1));
  const [adults, setAdults] = useState(String(booking?.adults ?? 1));
  const [children, setChildren] = useState(String(booking?.children ?? 0));
  const [guestName, setGuestName] = useState(booking?.guestName ?? "");
  const [phone, setPhone] = useState(booking?.phone ?? "");
  const [email, setEmail] = useState(booking?.email ?? "");
  const [channel, setChannel] = useState(booking?.channel ?? "");
  const [partnerId, setPartnerId] = useState(booking?.companyPartnerId ?? "");
  const [rate, setRate] = useState(booking ? String(booking.nightlyRate) : "");
  const [roomId, setRoomId] = useState(booking?.roomId ?? defaults?.roomId ?? NO_ROOM);
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const type = types.find((x) => x.id === roomTypeId);
  const rooms = (type?.rooms ?? []).filter((r) => r.isActive || r.id === roomId);

  const save = useMutation({
    mutationFn: () => {
      const body: SaveHotelBookingRequest = {
        storeId,
        roomTypeId,
        arrival,
        departure,
        guestName: guestName.trim(),
        adults: Number(adults),
        children: Number(children),
        roomId: roomId === NO_ROOM ? undefined : roomId,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        companyPartnerId: partnerId || undefined,
        channel: channel.trim() || undefined,
        // Empty: the room type's rate item price (the rack rate).
        nightlyRate: rate.trim() ? Number(rate) : undefined,
        notes: notes.trim() || undefined,
      };
      return booking
        ? apiClient.updatePosHotelBooking(activeCompanyId as string, booking.id, body)
        : apiClient.createPosHotelBooking(activeCompanyId as string, body);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(hotelBookingKey(activeCompanyId, saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: hotelCalendarKey(activeCompanyId) });
      onSaved(saved);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  const count = (v: string) => /^\d{1,2}$/.test(v.trim());
  const valid =
    !!roomTypeId && isIsoDate(arrival) && isIsoDate(departure) && departure > arrival && !!guestName.trim() &&
    count(adults) && Number(adults) >= 1 && count(children) && (rate.trim() === "" || Number(rate) >= 0);

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={booking ? t("hotel.booking.editTitle", { number: booking.number }) : t("hotel.booking.new")}
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
          <Field id="hb-type" label={t("hotel.room.type")} className="sm:col-span-2">
            <Select
              id="hb-type"
              value={roomTypeId}
              onValueChange={(v) => {
                setRoomTypeId(v);
                setRoomId(NO_ROOM);
              }}
              placeholder={t("hotel.booking.pickType")}
              options={types.filter((x) => x.isActive || x.id === roomTypeId).map((x) => ({
                value: x.id,
                label: `${x.name} · ${t("hotel.roomType.capacityN", { count: x.capacity })}`,
              }))}
            />
          </Field>
          <Field id="hb-arrival" label={t("hotel.booking.arrival")}>
            <Input id="hb-arrival" type="date" value={arrival} onChange={(e) => {
              setArrival(e.target.value);
              if (isIsoDate(e.target.value) && departure <= e.target.value) setDeparture(addDays(e.target.value, 1));
            }} />
          </Field>
          <Field id="hb-departure" label={t("hotel.booking.departure")}>
            <Input id="hb-departure" type="date" min={arrival} value={departure} onChange={(e) => setDeparture(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field id="hb-adults" label={t("hotel.booking.adults")}>
            <Input id="hb-adults" inputMode="numeric" className="text-right tabular-nums" value={adults} onChange={(e) => setAdults(e.target.value)} />
          </Field>
          <Field id="hb-children" label={t("hotel.booking.children")}>
            <Input id="hb-children" inputMode="numeric" className="text-right tabular-nums" value={children} onChange={(e) => setChildren(e.target.value)} />
          </Field>
          <Field id="hb-room" label={t("hotel.booking.room")}>
            <Select
              id="hb-room"
              value={roomId}
              onValueChange={setRoomId}
              disabled={!type}
              options={[{ value: NO_ROOM, label: t("hotel.booking.room.none") }, ...rooms.map((r) => ({ value: r.id, label: r.number }))]}
            />
          </Field>
          <Field id="hb-rate" label={t("hotel.booking.rate")}>
            <Input
              id="hb-rate"
              type="number"
              min={0}
              step="0.01"
              className="text-right tabular-nums"
              placeholder={type?.rate != null ? t("hotel.booking.rate.rack", { amount: money(type.rate) }) : t("hotel.booking.rate.placeholder")}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="hb-guest" label={t("hotel.booking.guestName")}>
            <Input id="hb-guest" autoFocus maxLength={120} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </Field>
          <Field id="hb-phone" label={t("hotel.booking.phone")}>
            <Input id="hb-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field id="hb-email" label={t("hotel.booking.email")}>
            <Input id="hb-email" type="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="hb-channel" label={t("hotel.booking.channel")}>
            <Input id="hb-channel" list="hb-channels" maxLength={60} value={channel} onChange={(e) => setChannel(e.target.value)} />
            <datalist id="hb-channels">
              {[t("hotel.channel.direct"), t("hotel.channel.phone"), t("hotel.channel.walkIn"), "Booking.com", "Airbnb", "Expedia", t("hotel.channel.agency")].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field id="hb-company" label={t("hotel.booking.company")}>
            <SearchableSelect
              id="hb-company"
              value={partnerId}
              onChange={setPartnerId}
              emptyOptionLabel={t("hotel.booking.company.none")}
              placeholder={t("hotel.booking.company.none")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              options={customers.map((p) => ({ value: p.id, label: p.name, description: p.fiscalNumber ?? undefined }))}
            />
          </Field>
        </div>
        <Field id="hb-notes" label={t("hotel.booking.notes")}>
          <Textarea id="hb-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// ---- Booking details ----

type Confirm = "cancel" | "noShow" | null;

export function BookingDetailsDialog({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const { canWrite } = useMyAccess();
  const writable = canWrite("pos");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const customers = useCustomers();

  const bookingQuery = useQuery({
    queryKey: hotelBookingKey(companyId, bookingId),
    queryFn: () => apiClient.getPosHotelBooking(companyId, bookingId),
    enabled: !!activeCompanyId,
  });
  const booking = bookingQuery.data;
  const folioId = booking?.folioTabId;
  const folio = useQuery({
    queryKey: tabKey(companyId, folioId ?? ""),
    queryFn: () => apiClient.getPosTab(companyId, folioId as string),
    enabled: !!activeCompanyId && !!folioId,
  });
  const till = useTabTill(booking?.storeId);

  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  const fail = (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError")));
  function bookingDone(next: HotelBookingResponse) {
    setError(null);
    queryClient.setQueryData(hotelBookingKey(companyId, next.id), next);
    void queryClient.invalidateQueries({ queryKey: hotelCalendarKey(companyId) });
  }
  function folioDone(next: TabResponse) {
    setError(null);
    queryClient.setQueryData(tabKey(companyId, next.id), next);
    void queryClient.invalidateQueries({ queryKey: hotelBookingKey(companyId, bookingId) });
  }
  const bookingAction = (fn: () => Promise<HotelBookingResponse>) => ({ mutationFn: fn, onSuccess: bookingDone, onError: fail });
  const folioAction = (fn: () => Promise<TabResponse>) => ({ mutationFn: fn, onSuccess: folioDone, onError: fail });

  const checkIn = useMutation(bookingAction(() => apiClient.checkInPosHotelBooking(companyId, bookingId)));
  const checkOut = useMutation(bookingAction(() => apiClient.checkOutPosHotelBooking(companyId, bookingId)));
  const deposit = useMutation(bookingAction(() => apiClient.getPosHotelDepositCard(companyId, bookingId)));
  const cancel = useMutation({
    ...bookingAction(() => apiClient.cancelPosHotelBooking(companyId, bookingId, confirm === "noShow")),
    onSettled: () => setConfirm(null),
  });
  const postNights = useMutation(folioAction(() => apiClient.postPosHotelNights(companyId, bookingId, undefined)));
  const prepare = useMutation(folioAction(() => apiClient.preparePosHotelCheckOut(companyId, bookingId)));
  const invoice = useMutation({
    mutationFn: () => apiClient.invoicePosHotelBooking(companyId, bookingId, { tabLineIds: selected }),
    onSuccess: (id: string) => {
      setError(null);
      setInvoiceId(id);
      setSelected([]);
      if (folioId) void queryClient.invalidateQueries({ queryKey: tabKey(companyId, folioId) });
    },
    onError: fail,
  });
  const busy = checkIn.isPending || checkOut.isPending || deposit.isPending || cancel.isPending || postNights.isPending || prepare.isPending || invoice.isPending;

  if (editing && booking)
    return <BookingFormDialog storeId={booking.storeId} booking={booking} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />;
  if (guestsOpen && booking)
    return <GuestsDialog booking={booking} onClose={() => setGuestsOpen(false)} onSaved={(next) => {
      bookingDone(next);
      setGuestsOpen(false);
    }} />;

  const reserved = booking?.state === HotelBookingState.Reserved;
  const inHouse = booking?.state === HotelBookingState.CheckedIn;
  const company = customers.find((p) => p.id === booking?.companyPartnerId);

  return (
    <FormDialog open onOpenChange={(o) => !o && !busy && onClose()} title={booking ? `${booking.number} · ${booking.guestName}` : t("common.loading")} size="lg">
      {!booking ? (
        bookingQuery.error ? <ErrorAlert message={getApiErrorMessage(bookingQuery.error, t("pos.saveError"))} /> : <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="booking-details">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={BOOKING_BADGE[booking.state] ?? "outline"} data-testid="booking-state">
              {t(`hotel.bookingState.${hotelBookingStateKey(booking.state)}`)}
            </Badge>
            <span className="flex items-center gap-1">
              <BedDouble className="size-4" /> {booking.roomTypeName} · {booking.roomNumber ?? t("hotel.booking.room.none")}
            </span>
            <span className="tabular-nums">
              {intl.formatDate(booking.arrival)} → {intl.formatDate(booking.departure)} · {t("hotel.booking.nights", { count: booking.nights })}
            </span>
            <span>{t("hotel.booking.party", { adults: booking.adults, children: booking.children })}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{t("hotel.booking.rateN", { amount: money(booking.nightlyRate) })}</span>
            {booking.channel && <span>{t("hotel.booking.channel")}: {booking.channel}</span>}
            {booking.phone && <span>{booking.phone}</span>}
            {booking.email && <span>{booking.email}</span>}
            {company && <span>{t("hotel.booking.company")}: {company.name}</span>}
            {booking.postedThrough && <span>{t("hotel.booking.postedThrough", { date: intl.formatDate(booking.postedThrough) })}</span>}
          </div>
          {booking.notes && <p className="whitespace-pre-line text-sm">{booking.notes}</p>}
          <ErrorAlert message={error} />

          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("hotel.guests")}</h3>
              {writable && (reserved || inHouse) && (
                <Button size="xs" variant="outline" onClick={() => setGuestsOpen(true)}>
                  <Pencil className="size-3" /> {t("hotel.guests.edit")}
                </Button>
              )}
            </div>
            {booking.guests.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("hotel.guests.none")}</p>
            ) : (
              <ul className="flex flex-col text-sm" data-testid="booking-guests">
                {booking.guests.map((g) => (
                  <li key={g.id} className="flex flex-wrap gap-x-3">
                    <span className="font-medium">{g.fullName}</span>
                    {g.nationality && <span>{g.nationality}</span>}
                    {g.documentNumber && <span className="text-muted-foreground">{g.documentType ? `${g.documentType} ` : ""}{g.documentNumber}</span>}
                    {g.birthDate && <span className="text-muted-foreground">{intl.formatDate(g.birthDate)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <DepositCardNote number={booking.depositCardNumber} deposited={booking.deposited} />

          {folioId && (
            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">{t("hotel.folio")}</h3>
              {folio.data ? (
                <FolioView
                  tab={folio.data}
                  selectable={inHouse && !!booking.companyPartnerId}
                  selected={selected}
                  onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              )}
              {invoiceId && (
                <p className="text-sm" data-testid="invoice-link">
                  {t("hotel.invoice.created")} <Link className="font-medium underline" to={`/invoicing/${invoiceId}`}>{t("hotel.invoice.open")}</Link>
                </p>
              )}
            </section>
          )}

          {writable && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <div className="flex flex-wrap gap-2">
                {(reserved || inHouse) && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                    <Pencil className="size-4" /> {t("hotel.booking.edit")}
                  </Button>
                )}
                {(reserved || inHouse) && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => deposit.mutate()}>
                    <CreditCard className="size-4" /> {t("hotel.deposit.get")}
                  </Button>
                )}
                {reserved && (
                  <Button size="sm" disabled={busy} onClick={() => checkIn.mutate()}>
                    <LogIn className="size-4" /> {t("hotel.checkIn")}
                  </Button>
                )}
                {inHouse && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => postNights.mutate()}>
                    <Moon className="size-4" /> {t("hotel.postTonight")}
                  </Button>
                )}
                {inHouse && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => prepare.mutate()}>
                    <FileText className="size-4" /> {t("hotel.prepareCheckOut")}
                  </Button>
                )}
                {inHouse && booking.companyPartnerId && (
                  <Button size="sm" variant="outline" disabled={busy || selected.length === 0} onClick={() => invoice.mutate()}>
                    <Receipt className="size-4" /> {t("hotel.billCompany", { count: selected.length })}
                  </Button>
                )}
              </div>
              {inHouse && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={busy || !till || !folioId}
                    onClick={() => till && folioId && navigate(tabTillUrl(till.id, folioId))}
                  >
                    <Wallet className="size-4" /> {t("hotel.payAtTill")}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => checkOut.mutate()}>
                    <LogOut className="size-4" /> {t("hotel.checkOut")}
                  </Button>
                  {!till && <span className="text-xs text-muted-foreground">{t("hotel.till.none")}</span>}
                </div>
              )}
              {reserved && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("noShow")}>{t("hotel.noShow")}</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("cancel")}>
                    <X className="size-4" /> {t("hotel.cancelBooking")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {confirm && booking && (
        <ConfirmDialog
          title={t(confirm === "noShow" ? "hotel.noShow.title" : "hotel.cancelBooking.title", { number: booking.number })}
          body={t(confirm === "noShow" ? "hotel.noShow.body" : "hotel.cancelBooking.body")}
          confirm={t(confirm === "noShow" ? "hotel.noShow" : "hotel.cancelBooking")}
          busy={cancel.isPending}
          onConfirm={() => cancel.mutate()}
          onClose={() => setConfirm(null)}
        />
      )}
    </FormDialog>
  );
}

// ---- The guests register of a booking (police reporting) ----

interface GuestDraft {
  key: string;
  fullName: string;
  nationality: string;
  documentType: string;
  documentNumber: string;
  birthDate: string;
}

const EMPTY_ID = "00000000-0000-0000-0000-000000000000";

function GuestsDialog({ booking, onClose, onSaved }: { booking: HotelBookingResponse; onClose: () => void; onSaved: (b: HotelBookingResponse) => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const blank = (fullName = ""): GuestDraft => ({ key: crypto.randomUUID(), fullName, nationality: "", documentType: "", documentNumber: "", birthDate: "" });
  const [rows, setRows] = useState<GuestDraft[]>(() =>
    booking.guests.length > 0
      ? booking.guests.map((g) => ({
          key: g.id, fullName: g.fullName, nationality: g.nationality ?? "", documentType: g.documentType ?? "",
          documentNumber: g.documentNumber ?? "", birthDate: g.birthDate ?? "",
        }))
      : [blank(booking.guestName)],
  );
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      apiClient.setPosHotelGuests(activeCompanyId as string, booking.id, {
        guests: rows.map<HotelGuestResponse>((g, i) => ({
          id: EMPTY_ID,
          fullName: g.fullName.trim(),
          nationality: g.nationality.trim() || undefined,
          documentType: g.documentType.trim() || undefined,
          documentNumber: g.documentNumber.trim() || undefined,
          birthDate: g.birthDate || undefined,
          isPrimary: i === 0,
        })),
      }),
    onSuccess: onSaved,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  const patch = (key: string, change: Partial<GuestDraft>) => setRows((all) => all.map((g) => (g.key === key ? { ...g, ...change } : g)));
  const valid = useMemo(() => rows.length > 0 && rows.every((g) => g.fullName.trim()), [rows]);
  return (
    <FormDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={`${t("hotel.guests")} · ${booking.number}`} size="xl">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setError(null);
          if (valid) save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">{t("hotel.guests.hint")}</p>
        <ErrorAlert message={error} />
        <ul className="flex flex-col gap-2">
          {rows.map((g, i) => (
            <li key={g.key} className="grid grid-cols-[1fr_8rem_8rem_10rem_9.5rem_auto] items-end gap-2" data-testid="guest-row">
              <Field id={`g-name-${g.key}`} label={i === 0 ? `${t("hotel.guest.fullName")} (${t("hotel.guest.primary")})` : t("hotel.guest.fullName")}>
                <Input id={`g-name-${g.key}`} maxLength={120} value={g.fullName} onChange={(e) => patch(g.key, { fullName: e.target.value })} />
              </Field>
              <Field id={`g-nat-${g.key}`} label={t("hotel.guest.nationality")}>
                <Input id={`g-nat-${g.key}`} maxLength={60} value={g.nationality} onChange={(e) => patch(g.key, { nationality: e.target.value })} />
              </Field>
              <Field id={`g-doct-${g.key}`} label={t("hotel.guest.documentType")}>
                <Input id={`g-doct-${g.key}`} list="g-doc-types" maxLength={40} value={g.documentType} onChange={(e) => patch(g.key, { documentType: e.target.value })} />
              </Field>
              <Field id={`g-docn-${g.key}`} label={t("hotel.guest.documentNumber")}>
                <Input id={`g-docn-${g.key}`} maxLength={40} value={g.documentNumber} onChange={(e) => patch(g.key, { documentNumber: e.target.value })} />
              </Field>
              <Field id={`g-birth-${g.key}`} label={t("hotel.guest.birthDate")}>
                <Input id={`g-birth-${g.key}`} type="date" value={g.birthDate} onChange={(e) => patch(g.key, { birthDate: e.target.value })} />
              </Field>
              <Button type="button" size="sm" variant="ghost" aria-label={t("hotel.guest.remove")} disabled={rows.length === 1} onClick={() => setRows((all) => all.filter((x) => x.key !== g.key))}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <datalist id="g-doc-types">
          <option value={t("hotel.guest.document.id")} />
          <option value={t("hotel.guest.document.passport")} />
        </datalist>
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setRows((all) => [...all, blank()])}>
          <Plus className="size-4" /> {t("hotel.guest.add")}
        </Button>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{t("common.save")}</Button>
        </div>
      </form>
    </FormDialog>
  );
}
