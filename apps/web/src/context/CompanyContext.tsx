import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { CompanyResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext";

const ACTIVE_COMPANY_KEY = "pako.activeCompanyId";

type CompanyContextValue = {
  companies: CompanyResponse[];
  activeCompanyId: string | null;
  activeCompany: CompanyResponse | null;
  loading: boolean;
  error: string | null;
  setActiveCompanyId: (id: string) => void;
  createCompany: (name: string, firmId?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const [companies, setCompanies] = useState<CompanyResponse[]>([]);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(() =>
    sessionStorage.getItem(ACTIVE_COMPANY_KEY),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.companiesAll();
      setCompanies(result);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load companies."));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    if (auth) {
      void refresh();
    } else {
      setCompanies([]);
      setActiveCompanyIdState(null);
      sessionStorage.removeItem(ACTIVE_COMPANY_KEY);
    }
  }, [auth, refresh]);

  useEffect(() => {
    if (activeCompanyId && companies.length > 0 && !companies.some((c) => c.id === activeCompanyId)) {
      setActiveCompanyIdState(null);
      sessionStorage.removeItem(ACTIVE_COMPANY_KEY);
    }
  }, [activeCompanyId, companies]);

  function setActiveCompanyId(id: string) {
    setActiveCompanyIdState(id);
    sessionStorage.setItem(ACTIVE_COMPANY_KEY, id);
  }

  async function createCompany(name: string, firmId?: string) {
    const created = await apiClient.companies({ name, firmId });
    await refresh();
    setActiveCompanyId(created.id);
  }

  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? null;

  return (
    <CompanyContext.Provider
      value={{
        companies,
        activeCompanyId,
        activeCompany,
        loading,
        error,
        setActiveCompanyId,
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
