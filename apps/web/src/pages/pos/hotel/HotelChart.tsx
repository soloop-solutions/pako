import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { HotelBookingResponse, HotelCalendarRoomResponse } from "@pako/shared";
import { ChevronLeft, ChevronRight, IdCard, Plus, Settings2 } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
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
import { HotelBookingState, ROOM_STATES, RoomState, hotelBookingStateKey, roomStateKey } from "@/lib/pos-enums";
import { cn } from "@/lib/utils";
import { BookingDetailsDialog, BookingFormDialog } from "@/pages/pos/hotel/BookingDialogs";
import { ErrorAlert } from "@/pages/pos/hotel/hotel-shared";
import { BOOKING_BADGE, addDays, daysBetween, hotelCalendarKey, isIsoDate, isoDate, parseIso } from "@/pages/pos/hotel/hotel-utils";

const DAY_W = 44;
const ROW_H = 34;
const MAX_DAYS = 62;

// State shows in form: reserved blue, in house green, gone grey, a no-show red and struck through.
const BAR_CLASS: Record<number, string> = {
  [HotelBookingState.Reserved]: "border-sky-600 bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-50",
  [HotelBookingState.CheckedIn]: "border-emerald-600 bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50",
  [HotelBookingState.CheckedOut]: "border-border bg-muted text-muted-foreground",
  [HotelBookingState.NoShow]: "border-red-500 bg-red-50 text-red-900 line-through dark:bg-red-950 dark:text-red-100",
};
const ROOM_STATE_CLASS: Record<number, string> = {
  [RoomState.Clean]: "border-emerald-600 text-emerald-700 dark:text-emerald-300",
  [RoomState.Dirty]: "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  [RoomState.OutOfService]: "border-red-600 bg-red-50 text-red-800 line-through dark:bg-red-950 dark:text-red-100",
};

// docs/POS_PLAN.md §6.4 / P5: the reservation chart — a store's rooms down, the days of the period
// across, each booking a bar from its arrival to its departure; housekeeping state per room; the
// bookings not yet given a room listed under it. Store, period and the open booking are URL params.
export function HotelChart() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite, canApprove } = useMyAccess();
  const writable = canWrite("pos");
  const storesQuery = usePosStores();
  const stores = useMemo(() => storesQuery.data ?? [], [storesQuery.data]);
  const today = isoDate(new Date());
  const [storeParam, setStoreParam] = useUrlParam("store");
  const [fromParam, setFrom] = useUrlParam("from", today);
  const [toParam, setTo] = useUrlParam("to", addDays(today, 13));
  const [bookingId, setBookingId] = useUrlParam("booking");
  const storeId = stores.some((s) => s.id === storeParam) ? storeParam : stores.find((s) => s.isActive)?.id ?? stores[0]?.id ?? "";
  const from = isIsoDate(fromParam) ? fromParam : today;
  const span = isIsoDate(toParam) ? Math.min(Math.max(daysBetween(from, toParam), 0), MAX_DAYS - 1) : 13;
  const to = addDays(from, span);
  const days = useMemo(() => Array.from({ length: span + 1 }, (_, i) => addDays(from, i)), [from, span]);
  const [creating, setCreating] = useState<{ roomTypeId?: string; roomId?: string; arrival?: string } | null>(null);
  const [roomFor, setRoomFor] = useState<HotelCalendarRoomResponse | null>(null);

  const calendar = useQuery({
    queryKey: [...hotelCalendarKey(activeCompanyId), storeId, from, to],
    queryFn: () => apiClient.getPosHotelCalendar(activeCompanyId as string, storeId, from, to),
    enabled: !!activeCompanyId && !!storeId,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const rooms = calendar.data?.rooms ?? [];
  const unassigned = calendar.data?.unassigned ?? [];

  const shift = (n: number) => {
    setFrom(addDays(from, n));
    setTo(addDays(to, n));
  };

  const unassignedColumns = useMemo<ColumnDef<HotelBookingResponse>[]>(
    () => [
      { accessorKey: "number", header: t("hotel.booking.number"), cell: ({ getValue }) => <span className="tabular-nums">{getValue() as string}</span> },
      { accessorKey: "guestName", header: t("hotel.booking.guestName") },
      { accessorKey: "roomTypeName", header: t("hotel.room.type") },
      { id: "arrival", header: t("hotel.booking.arrival"), accessorFn: (b) => b.arrival, cell: ({ row }) => intl.formatDate(row.original.arrival) },
      { id: "departure", header: t("hotel.booking.departure"), accessorFn: (b) => b.departure, cell: ({ row }) => intl.formatDate(row.original.departure) },
      { accessorKey: "nights", header: t("hotel.booking.nightsHeader"), meta: { numeric: true } },
      {
        id: "state",
        header: t("hotel.booking.state"),
        accessorFn: (b) => t(`hotel.bookingState.${hotelBookingStateKey(b.state)}`),
        cell: ({ row, getValue }) => <Badge variant={BOOKING_BADGE[row.original.state] ?? "outline"}>{getValue() as string}</Badge>,
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
            <CardTitle>{t("hotel.nav.chart")}</CardTitle>
            <CardDescription>{t("hotel.nav.chart.description")}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/pos/hotel/guests${storeId ? `?store=${storeId}` : ""}`)}>
              <IdCard className="size-4" /> {t("hotel.nav.guests")}
            </Button>
            {canApprove("pos") && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/pos/hotel/setup${storeId ? `?store=${storeId}` : ""}`)}>
                <Settings2 className="size-4" /> {t("hotel.nav.setup")}
              </Button>
            )}
            {writable && storeId && (
              <Button size="sm" onClick={() => setCreating({})}>
                <Plus className="size-4" /> {t("hotel.booking.new")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-56 flex-col gap-1">
              <Label htmlFor="hotel-store">{t("pos.register.store")}</Label>
              <Select id="hotel-store" value={storeId} onValueChange={setStoreParam} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="hotel-from">{t("hotel.period.from")}</Label>
              <Input id="hotel-from" type="date" className="w-40" value={from} onChange={(e) => isIsoDate(e.target.value) && setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="hotel-to">{t("hotel.period.to")}</Label>
              <Input id="hotel-to" type="date" className="w-40" min={from} value={to} onChange={(e) => isIsoDate(e.target.value) && setTo(e.target.value)} />
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" aria-label={t("hotel.period.prev")} onClick={() => shift(-7)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                setFrom(today);
                setTo(addDays(today, span));
              }}>
                {t("hotel.period.today")}
              </Button>
              <Button size="sm" variant="outline" aria-label={t("hotel.period.next")} onClick={() => shift(7)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <Legend />
          </div>
          {calendar.error && <ErrorAlert message={getApiErrorMessage(calendar.error, t("pos.saveError"))} />}

          {storeId && !calendar.isPending && rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("hotel.chart.noRooms")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border" data-testid="hotel-chart">
              <div style={{ minWidth: 160 + days.length * DAY_W }}>
                <div className="sticky top-0 z-20 flex border-b bg-muted text-xs">
                  <div className="sticky left-0 z-10 w-40 shrink-0 border-r bg-muted px-2 py-1 font-semibold">{t("hotel.room.number")}</div>
                  {days.map((d) => {
                    const date = parseIso(d);
                    const weekend = date.getDay() === 0 || date.getDay() === 6;
                    return (
                      <div
                        key={d}
                        className={cn("shrink-0 border-r py-1 text-center tabular-nums", weekend && "bg-muted-foreground/10", d === today && "bg-primary text-primary-foreground")}
                        style={{ width: DAY_W }}
                      >
                        <div>{intl.formatDate(date, { weekday: "short" })}</div>
                        <div className="font-semibold">{date.getDate()}</div>
                      </div>
                    );
                  })}
                </div>
                {rooms.map((room) => (
                  <div key={room.roomId} className="flex border-b last:border-b-0" style={{ height: ROW_H }} data-testid="chart-room">
                    <div className="sticky left-0 z-10 flex w-40 shrink-0 items-center gap-1 border-r bg-background px-2 text-sm">
                      <span className="font-semibold tabular-nums">{room.number}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{room.roomTypeName}</span>
                      <button
                        type="button"
                        disabled={!writable}
                        onClick={() => setRoomFor(room)}
                        className={cn("rounded border px-1 text-[10px] font-semibold uppercase", ROOM_STATE_CLASS[room.state])}
                        aria-label={t("hotel.roomState.label", { room: room.number, state: t(`hotel.roomState.${roomStateKey(room.state)}`) })}
                        data-testid="room-state"
                      >
                        {t(`hotel.roomState.short.${roomStateKey(room.state)}`)}
                      </button>
                    </div>
                    <div className="relative flex" style={{ width: days.length * DAY_W }}>
                      {days.map((d) => (
                        <button
                          key={d}
                          type="button"
                          tabIndex={-1}
                          disabled={!writable}
                          className={cn("h-full shrink-0 border-r hover:bg-accent", d === today && "bg-primary/5")}
                          style={{ width: DAY_W }}
                          aria-label={t("hotel.chart.newAt", { room: room.number, date: intl.formatDate(parseIso(d)) })}
                          onClick={() => setCreating({ roomTypeId: room.roomTypeId, roomId: room.roomId, arrival: d })}
                        />
                      ))}
                      {room.bookings.map((b) => {
                        // A night runs from the afternoon of one day to the morning of the next.
                        const start = Math.max(daysBetween(from, b.arrival) * DAY_W + DAY_W / 2, 0);
                        const end = Math.min(daysBetween(from, b.departure) * DAY_W + DAY_W / 2, days.length * DAY_W);
                        if (end <= start) return null;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setBookingId(b.id)}
                            className={cn("absolute top-1 bottom-1 truncate rounded border-2 px-1 text-left text-xs font-medium hover:brightness-95", BAR_CLASS[b.state])}
                            style={{ left: start + 1, width: end - start - 2 }}
                            title={`${b.number} · ${b.guestName} · ${t(`hotel.bookingState.${hotelBookingStateKey(b.state)}`)}`}
                            data-testid="booking-bar"
                            data-state={hotelBookingStateKey(b.state)}
                          >
                            {b.guestName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("hotel.unassigned")}</CardTitle>
          <CardDescription>{t("hotel.unassigned.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-hotel-unassigned"
            columns={unassignedColumns}
            data={unassigned}
            rowCount={unassigned.length}
            isLoading={calendar.isPending && !!storeId}
            getRowId={(b) => b.id}
            onRowClick={(b) => setBookingId(b.id)}
            emptyMessage={t("hotel.unassigned.empty")}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>

      {creating && storeId && (
        <BookingFormDialog
          storeId={storeId}
          defaults={creating}
          onClose={() => setCreating(null)}
          onSaved={(saved) => {
            setCreating(null);
            setBookingId(saved.id);
          }}
        />
      )}
      {bookingId && <BookingDetailsDialog key={bookingId} bookingId={bookingId} onClose={() => setBookingId("")} />}
      {roomFor && <RoomStateDialog room={roomFor} onClose={() => setRoomFor(null)} />}
    </div>
  );
}

function Legend() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {[HotelBookingState.Reserved, HotelBookingState.CheckedIn, HotelBookingState.CheckedOut, HotelBookingState.NoShow].map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span className={cn("inline-block h-3 w-5 rounded-sm border-2", BAR_CLASS[s])} />
          {t(`hotel.bookingState.${hotelBookingStateKey(s)}`)}
        </span>
      ))}
    </div>
  );
}

// Housekeeping: clean, dirty, out of service.
function RoomStateDialog({ room, onClose }: { room: HotelCalendarRoomResponse; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (state: number) => apiClient.setPosRoomState(activeCompanyId as string, room.roomId, { state }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: hotelCalendarKey(activeCompanyId) });
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && !set.isPending && onClose()} title={t("hotel.roomState.title", { room: room.number })} size="sm">
      <div className="flex flex-col gap-3">
        <ErrorAlert message={error} />
        <div className="grid grid-cols-3 gap-2">
          {ROOM_STATES.map((s) => (
            <Button
              key={s}
              variant={room.state === s ? "default" : "outline"}
              disabled={set.isPending}
              onClick={() => set.mutate(s)}
            >
              {t(`hotel.roomState.${roomStateKey(s)}`)}
            </Button>
          ))}
        </div>
      </div>
    </FormDialog>
  );
}
