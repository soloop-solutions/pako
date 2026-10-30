import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CompanyResponse, UpdateCompanyProfileRequest } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { recordCompanyOpened } from "@/lib/company-last-opened";
import { CompanyPresence, newTabId } from "@/lib/company-presence";

const ACTIVE_COMPANY_KEY = "pako.activeCompanyId";

export type CreateCompanyOptions = {
  isVatRegistered?: boolean;
  /** The rest of the company details, saved right after the company is created. */
  profile?: UpdateCompanyProfileRequest;
};

/** The company exists even when profileError is set: only its details failed to save. */
export type CreatedCompany = { company: CompanyResponse; profileError: unknown };

type CompanyContextValue = {
  companies: CompanyResponse[];
  activeCompanyId: string | null;
  activeCompany: CompanyResponse | null;
  loading: boolean;
  error: string | null;
  setActiveCompanyId: (id: string) => void;
  /** The company list has been fetched at least once for this sign-in. */
  loaded: boolean;
  /** Leaves the active company: the user goes back to the lobby to pick one. */
  leaveCompany: () => void;
  /** Companies this user has open in other tabs or windows (only one may be open at a time). */
  companiesOpenElsewhere: () => Promise<string[]>;
  /** Set when this tab's company was closed because another tab opened a different one. */
  replacedBy: { closedId: string; openedId: string } | null;
  clearReplacedNotice: () => void;
  createCompany: (name: string, firmId?: string, options?: CreateCompanyOptions) => Promise<CreatedCompany>;
  refresh: () => Promise<void>;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [companies, setCompanies] = useState<CompanyResponse[]>([]);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(() =>
    sessionStorage.getItem(ACTIVE_COMPANY_KEY),
  );
  const [loading, setLoading] = useState(false);
  // True once the company list has been fetched for this sign-in (successfully or not).
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacedBy, setReplacedBy] = useState<{ closedId: string; openedId: string } | null>(null);

  // One company at a time across this browser's tabs and windows (see lib/company-presence).
  const tabId = useRef(newTabId());
  const activeRef = useRef(activeCompanyId);
  activeRef.current = activeCompanyId;
  const presence = useRef<CompanyPresence | null>(null);
  const userId = auth?.userId ?? null;
  useEffect(() => {
    if (!userId) return;
    presence.current = new CompanyPresence(userId, tabId.current, () => activeRef.current, (newCompanyId) => {
      const closedId = activeRef.current;
      setActiveCompanyIdState(null);
      sessionStorage.removeItem(ACTIVE_COMPANY_KEY);
      // Nothing of the closed company may stay in memory.
      queryClient.clear();
      if (closedId) setReplacedBy({ closedId, openedId: newCompanyId });
    });
    // A tab restored on reload keeps its company only if no other tab has a different one open.
    let cancelled = false;
    const restored = activeRef.current;
    if (restored) {
      void presence.current.openElsewhere().then((open) => {
        const other = open.find((id) => id !== restored);
        if (!cancelled && other && activeRef.current === restored) {
          setActiveCompanyIdState(null);
          sessionStorage.removeItem(ACTIVE_COMPANY_KEY);
          setReplacedBy({ closedId: restored, openedId: other });
        }
      });
    }
    return () => {
      cancelled = true;
      presence.current?.close();
      presence.current = null;
    };
  }, [userId, queryClient]);

  const refresh = useCallback(async () => {
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.companiesAll(true);
      setCompanies(result);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load companies."));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [auth]);

  useEffect(() => {
    if (auth) {
      void refresh();
    } else {
      setCompanies([]);
      setLoaded(false);
      setActiveCompanyIdState(null);
      sessionStorage.removeItem(ACTIVE_COMPANY_KEY);
    }
  }, [auth, refresh]);

  useEffect(() => {
    if (activeCompanyId && loaded && !companies.some((c) => c.id === activeCompanyId)) {
      setActiveCompanyIdState(null);
      sessionStorage.removeItem(ACTIVE_COMPANY_KEY);
    }
  }, [activeCompanyId, companies, loaded]);

  function setActiveCompanyId(id: string) {
    setActiveCompanyIdState(id);
    setReplacedBy(null);
    sessionStorage.setItem(ACTIVE_COMPANY_KEY, id);
    presence.current?.announceOpened(id);
    if (auth) recordCompanyOpened(auth.userId, id);
  }

  function leaveCompany() {
    setActiveCompanyIdState(null);
    sessionStorage.removeItem(ACTIVE_COMPANY_KEY);
  }

  // Companies are created only from the lobby, which then opens the new one.
  async function createCompany(name: string, firmId?: string, options?: CreateCompanyOptions): Promise<CreatedCompany> {
    const created = await apiClient.companies({ name, firmId, isVatRegistered: options?.isVatRegistered });
    let profileError: unknown = null;
    if (options?.profile) {
      try {
        await apiClient.profile(created.id, options.profile);
      } catch (err) {
        profileError = err;
      }
    }
    await refresh();
    return { company: created, profileError };
  }

  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? null;

  return (
    <CompanyContext.Provider
      value={{
        companies,
        activeCompanyId,
        activeCompany,
        loading,
        loaded,
        error,
        setActiveCompanyId,
        leaveCompany,
        companiesOpenElsewhere: () => presence.current?.openElsewhere() ?? Promise.resolve([]),
        replacedBy,
        clearReplacedNotice: () => setReplacedBy(null),
        createCompany,
        refresh,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within a CompanyProvider");
  return ctx;
}
