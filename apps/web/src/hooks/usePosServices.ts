import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

// docs/POS_PLAN.md P4: shared queries of the services screens.

export const resourcesKey = (companyId: string | null, storeId?: string) => ["posResources", companyId, storeId ?? ""] as const;

/** The company's members (user id and e-mail): who a resource or a repair technician is. */
export function useCompanyMembers() {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: ["members", activeCompanyId],
    queryFn: () => apiClient.membersAll(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 5 * 60_000,
  });
}
