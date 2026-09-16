import type { TabKind } from "@/config/tabs";

export interface StoredTab {
  id: string;
  kind: TabKind;
  path: string;
}

export function tabsStorageKey(userId: string, companyId: string | null): string {
  return `pako.tabs.${userId}.${companyId ?? "none"}`;
}

export function loadTabs(key: string): StoredTab[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredTab =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as StoredTab).id === "string" &&
        typeof (entry as StoredTab).path === "string" &&
        ((entry as StoredTab).kind === "singleton" || (entry as StoredTab).kind === "instance"),
    );
  } catch {
    return [];
  }
}

export function saveTabs(key: string, tabs: StoredTab[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(tabs));
  } catch {
    // Storage unavailable (private mode, quota) — tabs simply won't persist across reloads.
  }
}
