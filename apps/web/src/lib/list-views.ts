import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";

// Views a user saves from a list ribbon ("Overdue this quarter", "Market Arbeni — last month"):
// a name plus the ribbon's URL query for one grid. A display preference like remembered columns —
// losing one costs a few clicks, never data — so it is kept in this browser, per user and company.
// The sidebar lists them under the page (next to the built-in saved views).
export interface SavedListView {
  id: string;
  name: string;
  /** `gridId.name=value&…`, appended to the page path. */
  query: string;
}

type Store = Record<string, SavedListView[]>;

const EVENT = "pako:list-views";

function storageKey(userId: string, companyId: string) {
  return `pako.listViews.${userId}.${companyId}`;
}

function read(key: string | null): Store {
  if (!key) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(key: string | null, store: Store) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

/** Every saved view of the signed-in user in the active company, by grid id; live-updating. */
export function useAllSavedListViews(): { views: Store; save: (gridId: string, name: string, query: string) => void; remove: (gridId: string, id: string) => void } {
  const { auth } = useAuth();
  const { activeCompanyId } = useCompany();
  const key = auth?.userId && activeCompanyId ? storageKey(auth.userId, activeCompanyId) : null;
  const [store, setStore] = useState<{ key: string | null; views: Store }>(() => ({ key, views: read(key) }));

  useEffect(() => {
    setStore({ key, views: read(key) });
    const reload = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) setStore({ key, views: read(key) });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) setStore({ key, views: read(key) });
    };
    window.addEventListener(EVENT, reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);

  const save = useCallback(
    (gridId: string, name: string, query: string) => {
      const current = read(key);
      const others = (current[gridId] ?? []).filter((v) => v.name.trim().toLowerCase() !== name.trim().toLowerCase());
      write(key, { ...current, [gridId]: [...others, { id: `${Date.now()}`, name: name.trim(), query }] });
    },
    [key],
  );

  const remove = useCallback(
    (gridId: string, id: string) => {
      const current = read(key);
      write(key, { ...current, [gridId]: (current[gridId] ?? []).filter((v) => v.id !== id) });
    },
    [key],
  );

  return { views: store.key === key ? store.views : read(key), save, remove };
}
