import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CompanyResponse } from '@pako/shared';

import { apiClient, getApiErrorMessage } from '@/api/client';
import { useAuth } from '@/context/auth-context';
import { clearStoredActiveCompanyId, getStoredActiveCompanyId, setStoredActiveCompanyId } from '@/lib/company-storage';

type CompanyContextValue = {
  companies: CompanyResponse[];
  activeCompanyId: string | null;
  activeCompany: CompanyResponse | null;
  loading: boolean;
  error: string | null;
  setActiveCompanyId: (id: string) => void;
  createCompany: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const [companies, setCompanies] = useState<CompanyResponse[]>([]);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.companiesAll();
      setCompanies(result);
      setActiveCompanyIdState((current) => {
        if (current && !result.some((c) => c.id === current)) {
          void clearStoredActiveCompanyId();
          return null;
        }
        return current;
      });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load companies.'));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void (async () => {
      if (auth) {
        const stored = await getStoredActiveCompanyId();
        setActiveCompanyIdState(stored);
        await refresh();
      } else {
        setCompanies([]);
        setActiveCompanyIdState(null);
        await clearStoredActiveCompanyId();
      }
    })();
  }, [auth, refresh]);

  function setActiveCompanyId(id: string) {
    setActiveCompanyIdState(id);
    void setStoredActiveCompanyId(id);
  }

  async function createCompany(name: string) {
    const created = await apiClient.companies({ name });
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

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within a CompanyProvider');
  return ctx;
}
