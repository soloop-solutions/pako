import { useMemo, useState } from "react";
import type { HotelBookingResponse, TabResponse } from "@pako/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BedDouble } from "lucide-react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { FormDialog } from "@/components/shared/FormDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/context/CompanyContext";
import { HotelBookingState } from "@/lib/pos-enums";
import { addDays, hotelCalendarKey, isoDate } from "@/pages/pos/hotel/hotel-utils";

// docs/POS_PLAN.md §6.4 / P5: a restaurant or bar tab charged to a checked-in room. The tab's
// unpaid lines move to the guest's folio (the server checks the guest is in house); the guest pays
// them with the stay at check-out.
export function ChargeToRoomDialog({ tab, onClose, onDone }: { tab: TabResponse; onClose: () => void; onDone: (folio: TabResponse) => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Yesterday through today: every stay that is in house now, departing today included.
  const today = isoDate(new Date());
  const from = addDays(today, -1);
  const calendar = useQuery({
    queryKey: [...hotelCalendarKey(companyId), tab.storeId, from, today],
    queryFn: () => apiClient.getPosHotelCalendar(companyId, tab.storeId, from, today),
    staleTime: 0,
  });
  const inHouse = useMemo(() => {
    const all = [...(calendar.data?.rooms.flatMap((r) => r.bookings) ?? []), ...(calendar.data?.unassigned ?? [])];
    const seen = new Set<string>();
    const q = term.trim().toLowerCase();
    return all
      .filter((b) => b.state === HotelBookingState.CheckedIn && !seen.has(b.id) && !!seen.add(b.id))
      .filter((b) => !q || (b.roomNumber ?? "").toLowerCase().includes(q) || b.guestName.toLowerCase().includes(q) || b.number.toLowerCase().includes(q))
      .sort((a, b) => (a.roomNumber ?? "").localeCompare(b.roomNumber ?? "", undefined, { numeric: true }));
  }, [calendar.data, term]);

  const charge = useMutation({
    mutationFn: (booking: HotelBookingResponse) => apiClient.chargePosTabToRoom(companyId, tab.id, booking.id),
    onSuccess: onDone,
    onError: (err: unknown) => setError(getApiErrorMessage(err, t("pos.saveError"))),
  });

  return (
    <FormDialog open onOpenChange={(o) => !o && !charge.isPending && onClose()} title={t("hotel.chargeToRoom.title", { number: tab.number })} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("hotel.chargeToRoom.hint")}</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("hotel.chargeToRoom.search")}
          aria-label={t("hotel.chargeToRoom.search")}
        />
        {calendar.isPending ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : calendar.error ? (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(calendar.error, t("pos.saveError"))}</AlertDescription>
          </Alert>
        ) : inHouse.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("hotel.chargeToRoom.none")}</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
            {inHouse.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  disabled={charge.isPending}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => charge.mutate(b)}
                  data-testid="charge-room"
                >
                  <BedDouble className="size-4 shrink-0" />
                  <span className="w-14 font-bold tabular-nums">{b.roomNumber}</span>
                  <span className="min-w-0 flex-1 truncate">{b.guestName}</span>
                  <span className="text-xs text-muted-foreground">{t("hotel.chargeToRoom.until", { date: intl.formatDate(b.departure) })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={charge.isPending}>{t("common.cancel")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}
