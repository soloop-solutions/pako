import { useQuery } from "@tanstack/react-query";
import type { LeaveTypeResponse } from "@pako/shared";

import { apiClient } from "@/api/client";

// Leave request lifecycle as the API spells it (LeaveRequestResponse.state is LeaveRequestState.ToString()).
export const LEAVE_STATES = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
export type LeaveState = (typeof LEAVE_STATES)[number];

export function isLeaveState(value: string | null | undefined): value is LeaveState {
  return !!value && (LEAVE_STATES as readonly string[]).includes(value);
}

// "Low" is a display cue only — at or under this many days left the remaining cell turns amber.
const LOW_REMAINING_DAYS = 2;

export function remainingTone(row: { remaining: number; allocated: number }): "negative" | "low" | null {
  if (row.remaining < 0) return "negative";
  if (row.allocated > 0 && row.remaining <= LOW_REMAINING_DAYS) return "low";
  return null;
}

// Which row actions a request offers in each state. The server is the authority (it refuses a
// decision on anything not Pending, and Cancel on anything already closed) — this only decides
// which buttons to show.
export function leaveRequestActions(state: string): { approve: boolean; reject: boolean; cancel: boolean } {
  return {
    approve: state === "Pending",
    reject: state === "Pending",
    cancel: state === "Pending" || state === "Approved",
  };
}

/** "2026-10-14T09:12:00Z" → "2026-10-14 09:12" in local time; date-only strings pass through. */
export function formatDateTime(value: string | undefined | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/** DateOnly values come back as "yyyy-MM-dd" (sometimes with a time part); show the date only. */
export function formatDate(value: string | undefined | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function currentYear(): number {
  return new Date().getFullYear();
}

export function parseYear(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : currentYear();
}

export function yearOptions(selected: number): number[] {
  const now = currentYear();
  const years = new Set<number>([now - 2, now - 1, now, now + 1, selected]);
  return [...years].sort((a, b) => b - a);
}

export function leaveTypesQueryKey(companyId: string | null) {
  return ["leave", "types", companyId] as const;
}

export function useLeaveTypes(companyId: string | null) {
  return useQuery({
    queryKey: leaveTypesQueryKey(companyId),
    queryFn: (): Promise<LeaveTypeResponse[]> => apiClient.listLeaveTypes(companyId as string),
    enabled: !!companyId,
  });
}
