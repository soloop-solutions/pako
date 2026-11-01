import type { RegisterResponse } from "@pako/shared";

import { usePosRegisters } from "@/hooks/usePos";
import { EventBookingState, HotelBookingState, RegisterProfile } from "@/lib/pos-enums";

// docs/POS_PLAN.md §6.4–6.5 / P5: helpers shared by the hotel, events and ticketing pages.

export const money = (v: number | undefined) => (v ?? 0).toFixed(2);

// ---- Calendar dates (DateOnly on the wire: "yyyy-MM-dd") ----

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parses "yyyy-MM-dd" as a local calendar day (no time zone shift). */
export function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const addDays = (iso: string, days: number) => {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

/** Whole days from `a` to `b` (calendar arithmetic for laying out the chart, not money). */
export const daysBetween = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);

export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(parseIso(v).getTime());

// ---- Event start times: entered in Kosovo time (Europe/Belgrade), stored in UTC ----

export const VENUE_TIME_ZONE = "Europe/Belgrade";

/** Minutes the zone is ahead of UTC at a given instant. */
function zoneOffsetMinutes(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** "2026-11-20T20:00" read as Europe/Belgrade wall time → an ISO instant in UTC. */
export function zonedInputToUtc(local: string, timeZone = VENUE_TIME_ZONE): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return "";
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let utc = wall - zoneOffsetMinutes(wall, timeZone) * 60_000;
  // Once more around a DST change, where the first guess's offset is the other side's.
  utc = wall - zoneOffsetMinutes(utc, timeZone) * 60_000;
  return new Date(utc).toISOString();
}

/** An ISO instant → the "yyyy-MM-ddTHH:mm" a datetime-local input shows, in Europe/Belgrade. */
export function utcToZonedInput(iso: string, timeZone = VENUE_TIME_ZONE): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const local = new Date(ms + zoneOffsetMinutes(ms, timeZone) * 60_000);
  return local.toISOString().slice(0, 16);
}

/** A time of day from the API ("HH:mm:ss") as "HH:mm". */
export const shortTime = (v: string | undefined) => (v ? v.slice(0, 5) : "");

// ---- The till that takes a folio or an event bill ----

/**
 * A café or restaurant register of the store (one with an open session first): its till opens a
 * tab by `?tab=<id>` and pays it like any table's bill.
 */
export function useTabTill(storeId: string | undefined): RegisterResponse | undefined {
  const registers = usePosRegisters().data ?? [];
  const fit = registers.filter(
    (r) => r.isActive && r.storeId === storeId && (r.profile === RegisterProfile.Cafe || r.profile === RegisterProfile.Restaurant),
  );
  return fit.find((r) => !!r.openSessionId) ?? fit[0];
}

export const tabTillUrl = (registerId: string, tabId: string) => `/pos/till/${registerId}?tab=${tabId}`;

// ---- Query keys ----

export const roomTypesKey = (companyId: string | null, storeId: string) => ["posRoomTypes", companyId, storeId] as const;
export const hotelCalendarKey = (companyId: string | null) => ["posHotelCalendar", companyId] as const;
export const hotelBookingKey = (companyId: string | null, bookingId: string) => ["posHotelBooking", companyId, bookingId] as const;
export const tabKey = (companyId: string | null, tabId: string) => ["posTab", companyId, tabId] as const;

/** Badge per booking state: reserved outlined, in-house green, gone muted, cancelled struck through. */
export const BOOKING_BADGE: Record<number, "outline" | "success" | "secondary" | "cancelled" | "destructive"> = {
  [HotelBookingState.Reserved]: "outline",
  [HotelBookingState.CheckedIn]: "success",
  [HotelBookingState.CheckedOut]: "secondary",
  [HotelBookingState.Cancelled]: "cancelled",
  [HotelBookingState.NoShow]: "destructive",
};

/** Badge per event state: tentative outlined, confirmed green, done muted, cancelled struck through. */
export const EVENT_BADGE: Record<number, "outline" | "success" | "secondary" | "cancelled"> = {
  [EventBookingState.Tentative]: "outline",
  [EventBookingState.Confirmed]: "success",
  [EventBookingState.Completed]: "secondary",
  [EventBookingState.Cancelled]: "cancelled",
};
