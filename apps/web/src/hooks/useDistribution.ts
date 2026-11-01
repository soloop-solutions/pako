import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

// docs/POS_PLAN.md P6 — the company's partners (cached; the same key the partner pages use).
export function usePartners() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["partners", activeCompanyId],
    queryFn: () => apiClient.partnersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });
}

// What a customer owes, has on open orders and whether overdue invoices block new orders. Every
// figure comes from the API.
export function useCreditStatus(partnerId: string | undefined) {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["creditStatus", activeCompanyId, partnerId],
    queryFn: () => apiClient.getCustomerCreditStatus(activeCompanyId as string, partnerId as string),
    enabled: !!activeCompanyId && !!partnerId,
    staleTime: 15_000,
  });
}

// Customer price lists, for the partner form.
export function usePriceLists() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["priceLists", activeCompanyId],
    queryFn: () => apiClient.listPriceLists(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });
}
