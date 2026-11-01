import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

export const posStoresKey = (companyId: string | null) => ["posStores", companyId] as const;
export const posRegistersKey = (companyId: string | null) => ["posRegisters", companyId] as const;

export function usePosStores() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: posStoresKey(activeCompanyId),
    queryFn: () => apiClient.listPosStores(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
}

export function usePosRegisters() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: posRegistersKey(activeCompanyId),
    queryFn: () => apiClient.listPosRegisters(activeCompanyId as string),
    enabled: !!activeCompanyId,
  });
}
