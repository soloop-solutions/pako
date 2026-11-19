import { useQuery } from "@tanstack/react-query";
import type { AccountResponse } from "@pako/shared";

import { apiClient } from "@/api/client";

// The chart of accounts for the asset pickers, postable and active only.
export function usePostableAccounts(companyId: string) {
  return useQuery({
    queryKey: ["accounts", companyId, "all"],
    queryFn: () => apiClient.accountsAll(companyId),
    select: (accounts: AccountResponse[]) => accounts.filter((a) => a.isActive !== false && a.isPostable !== false && !a.isControl),
  });
}

// Options for an account picker: accounts whose code starts with one of the prefixes first (the
// usual 15xxxx / 159xxx / 65xxxx), then every other postable account so nothing is out of reach.
export function accountOptions(accounts: AccountResponse[] | undefined, prefixes: string[], exclude: string[] = []) {
  const all = (accounts ?? []).filter((a) => !exclude.some((p) => a.code.startsWith(p)));
  const matches = (a: AccountResponse) => prefixes.some((p) => a.code.startsWith(p));
  const sorted = [...all.filter(matches), ...all.filter((a) => !matches(a))];
  return sorted.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
}

export function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function formatMonth(iso: string | undefined | null): string {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  return `${m}/${y}`;
}
