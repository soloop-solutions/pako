import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

// The active company's bank accounts, printed on the invoice preview (client request 2026-11-23).
export function useCompanyBankAccounts() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["companyBankAccounts", activeCompanyId],
    queryFn: () => apiClient.bankAccountsAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });
}
