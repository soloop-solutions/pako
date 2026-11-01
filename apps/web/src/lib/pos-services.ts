import type { PackageResponse, RegisterResponse } from "@pako/shared";

import { RegisterProfile } from "@/lib/pos-enums";

// docs/POS_PLAN.md P4 (services). Pako.Api doesn't emit enum member names, so these arrive as plain
// numbers. Order must match backend/Pako.Domain/Pos exactly, by hand.
export const ResourceKind = { Staff: 0, Room: 1, Equipment: 2 } as const;
export const RESOURCE_KINDS = [0, 1, 2] as const;
export const resourceKindKey = (k: number) => ["staff", "room", "equipment"][k] ?? "staff";

export const AppointmentState = { Booked: 0, Confirmed: 1, CheckedIn: 2, Completed: 3, NoShow: 4, Cancelled: 5 } as const;
export const APPOINTMENT_STATES = [0, 1, 2, 3, 4, 5] as const;
export const appointmentStateKey = (s: number) => ["booked", "confirmed", "checkedIn", "completed", "noShow", "cancelled"][s] ?? "booked";

export const AppointmentSource = { Staff: 0, Online: 1 } as const;

export const MembershipState = { Active: 0, Frozen: 1, Cancelled: 2 } as const;
export const membershipStateKey = (s: number) => ["active", "frozen", "cancelled"][s] ?? "active";

export const RepairState = {
  Received: 0, Diagnosing: 1, WaitingApproval: 2, Approved: 3, InRepair: 4, Ready: 5, Collected: 6, Cancelled: 7,
} as const;
export const REPAIR_STATES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export const repairStateKey = (s: number) =>
  ["received", "diagnosing", "waitingApproval", "approved", "inRepair", "ready", "collected", "cancelled"][s] ?? "received";

/** Weekdays as the API numbers them: Monday 0 … Sunday 6. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

// ---- Kosovo time ----
// The API speaks UTC; people book and read times in Europe/Belgrade (Kosovo's zone). Date and time
// arithmetic only — never money.
export const POS_TIME_ZONE = "Europe/Belgrade";

/** An API DateTime as a Date: a value without an offset is UTC. */
export function parseUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

function parts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: POS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Kosovo calendar day of an instant, "YYYY-MM-DD". */
export function localDate(date: Date | string): string {
  const p = parts(typeof date === "string" ? parseUtc(date) : date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** The Kosovo wall-clock time of an instant, "HH:mm". */
export function localTime(date: Date | string): string {
  const p = parts(typeof date === "string" ? parseUtc(date) : date);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** Minutes since Kosovo midnight of an instant. */
export function localMinutes(date: Date | string): number {
  const p = parts(typeof date === "string" ? parseUtc(date) : date);
  return p.h * 60 + p.mi;
}

/** The UTC instant of a Kosovo date and wall-clock time ("YYYY-MM-DD", "HH:mm"), as ISO. */
export function utcFromLocal(date: string, time = "00:00"): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ts: number) => {
    const p = parts(new Date(ts));
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ts;
  };
  let ts = wall - offsetAt(wall);
  // Across a DST change the offset at the result can differ from the first guess.
  ts = wall - offsetAt(ts);
  return new Date(ts).toISOString();
}

/** A Kosovo date plus (or minus) whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The API's weekday (Monday 0 … Sunday 6) of a calendar date. */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday of the week a date falls in. */
export const weekStart = (date: string) => addDays(date, -weekday(date));

export const todayLocal = () => localDate(new Date());

/** "HH:mm" (or "HH:mm:ss") as minutes since midnight. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** A store's till for a deep link: an active, staffed counter register (not a restaurant or a self-checkout lane) — one with an open session first. */
export function pickTillRegister(registers: RegisterResponse[], storeId: string): RegisterResponse | undefined {
  const candidates = registers.filter(
    (r) => r.storeId === storeId && r.isActive && r.profile !== RegisterProfile.Cafe && r.profile !== RegisterProfile.Restaurant
      && r.profile !== RegisterProfile.SelfCheckout,
  );
  return candidates.find((r) => !!r.openSessionId) ?? candidates[0];
}

/** A package can give a session today: active, sessions left, not expired (a date comparison). */
export const packageUsable = (p: PackageResponse) => p.isActive && p.sessionsLeft > 0 && (!p.expiresOn || p.expiresOn >= todayLocal());
