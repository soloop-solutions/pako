import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { resolveTab } from "@/config/tabs";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { loadTabs, saveTabs, tabsStorageKey, type StoredTab } from "@/lib/tabs-storage";

export interface ResolvedTab {
  id: string;
  kind: "singleton" | "instance";
  path: string;
  icon: LucideIcon;
  titleKey?: string;
  fallbackTitleKey?: string;
  titleOverride: string | null;
  dirty: boolean;
}

interface TabsContextValue {
  tabs: ResolvedTab[];
  activeTabId: string | null;
  closeTab: (id: string) => void;
  focusTab: (id: string) => void;
  cycleTab: (direction: 1 | -1) => void;
  setTabDirty: (id: string, dirty: boolean) => void;
  setTabTitleOverride: (id: string, title: string | null) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const { activeCompanyId } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();

  const storageKey = auth ? tabsStorageKey(auth.userId, activeCompanyId) : null;

  const [storedTabs, setStoredTabs] = useState<StoredTab[]>([]);
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const loadedKeyRef = useRef<string | null>(null);

  // Reload the open-tab list whenever the user or the active company changes — the list is
  // scoped to both, per FRONTEND_START_PROMPT's "localStorage keyed by user + company".
  useEffect(() => {
    if (!storageKey) {
      setStoredTabs([]);
      loadedKeyRef.current = null;
      return;
    }
    if (loadedKeyRef.current === storageKey) return;
    loadedKeyRef.current = storageKey;
    setStoredTabs(loadTabs(storageKey));
    setTitleOverrides({});
    setDirtyMap({});
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    saveTabs(storageKey, storedTabs);
  }, [storageKey, storedTabs]);

  const resolution = resolveTab(location.pathname);

  // Open (or refocus) the tab for wherever the router currently is.
  useEffect(() => {
    if (!resolution) return;
    const fullPath = location.pathname + location.search;
    setStoredTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === resolution.id);
      if (idx === -1) {
        return [...prev, { id: resolution.id, kind: resolution.kind, path: fullPath }];
      }
      if (prev[idx].path === fullPath) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], path: fullPath };
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const activeTabId = resolution?.id ?? null;

  const tabs: ResolvedTab[] = useMemo(
    () =>
      storedTabs.flatMap((stored) => {
        // stored.id is always a resolvable pathname (it was produced by resolveTab when the tab
        // was opened); skip anything that no longer resolves, e.g. a route removed since.
        const resolved = resolveTab(stored.id);
        if (!resolved) return [];
        return [
          {
            id: stored.id,
            kind: stored.kind,
            path: stored.path,
            icon: resolved.icon,
            titleKey: resolved.titleKey,
            fallbackTitleKey: resolved.fallbackTitleKey,
            titleOverride: titleOverrides[stored.id] ?? null,
            dirty: dirtyMap[stored.id] ?? false,
          },
        ];
      }),
    [storedTabs, titleOverrides, dirtyMap],
  );

  // Closing a dirty tab: simplest version is to close it silently and discard the draft.
  // TODO: SHELL_SPEC §2 leaves this an open decision — the alternative is a confirm prompt
  // ("You have unsaved changes — close anyway?") before closing a tab whose `dirty` flag is set.
  const closeTab = useCallback(
    (id: string) => {
      setStoredTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.id !== id);
        if (id === activeTabId) {
          const fallback = next[idx - 1] ?? next[idx] ?? null;
          navigate(fallback ? fallback.path : "/dashboard");
        }
        return next;
      });
      setTitleOverrides((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setDirtyMap((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [activeTabId, navigate],
  );

  const focusTab = useCallback(
    (id: string) => {
      const tab = storedTabs.find((t) => t.id === id);
      if (tab) navigate(tab.path);
    },
    [storedTabs, navigate],
  );

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      if (tabs.length === 0) return;
      const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
      const startIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = (startIndex + direction + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (next) navigate(next.path);
    },
    [tabs, activeTabId, navigate],
  );

  const setTabDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyMap((prev) => {
      if ((prev[id] ?? false) === dirty) return prev;
      return { ...prev, [id]: dirty };
    });
  }, []);

  const setTabTitleOverride = useCallback((id: string, title: string | null) => {
    setTitleOverrides((prev) => {
      if (title === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id] === title) return prev;
      return { ...prev, [id]: title };
    });
  }, []);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (!event.ctrlKey) return;
      if (event.key === "Tab") {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
      } else if (event.key.toLowerCase() === "w") {
        // Chrome and most browsers reserve Ctrl+W for closing the actual browser tab and will
        // not let a page override it; this still fires in browsers/contexts that do allow it
        // (Firefox in some cases, Electron shells, etc).
        if (activeTabId) {
          event.preventDefault();
          closeTab(activeTabId);
        }
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [cycleTab, closeTab, activeTabId]);

  const value = useMemo(
    () => ({ tabs, activeTabId, closeTab, focusTab, cycleTab, setTabDirty, setTabTitleOverride }),
    [tabs, activeTabId, closeTab, focusTab, cycleTab, setTabDirty, setTabTitleOverride],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used within a TabsProvider");
  return ctx;
}

// Lets a document page (InvoiceDetail, BillDetail, ...) report its real title and unsaved-changes
// state once it has loaded, overriding the generic fallback title used when the tab was opened.
// eslint-disable-next-line react-refresh/only-export-components
export function useTabMeta(meta: { title?: string; dirty?: boolean }) {
  const { activeTabId, setTabTitleOverride, setTabDirty } = useTabs();
  const { title, dirty } = meta;

  useEffect(() => {
    if (!activeTabId || title === undefined) return;
    setTabTitleOverride(activeTabId, title);
  }, [activeTabId, title, setTabTitleOverride]);

  useEffect(() => {
    if (!activeTabId || dirty === undefined) return;
    setTabDirty(activeTabId, dirty);
  }, [activeTabId, dirty, setTabDirty]);
}
