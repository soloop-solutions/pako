import { useQuery } from "@tanstack/react-query";
import type { MyAccessResponse } from "@pako/shared";

import { apiClient } from "@/api/client";
import type { NavModule } from "@/config/nav";
import { useCompany } from "@/context/CompanyContext";
import { AccessLevel } from "@/lib/hr-enums";

export interface MyAccess {
  /** The raw response, or null while loading / on error / with no active company. */
  access: MyAccessResponse | null;
  isLoading: boolean;
  /** True when the user is a ClientStaff member (rights come from their department). */
  isStaff: boolean;
  canSee: (module: NavModule) => boolean;
  canWrite: (module: NavModule) => boolean;
}

export const myAccessQueryKey = (companyId: string | null) => ["myAccess", companyId] as const;

/**
 * What the signed-in user may see and change in the active company, per module. Display only —
 * the API enforces every rule itself. While the answer is loading or failed, everything is treated
 * as allowed so the UI never hides something the server would have permitted.
 */
export function useMyAccess(): MyAccess {
  const { activeCompanyId } = useCompany();
  const query = useQuery({
    queryKey: myAccessQueryKey(activeCompanyId),
    queryFn: () => apiClient.getMyAccess(activeCompanyId as string),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });

  const access = query.data ?? null;

  function level(module: NavModule): number {
    if (!access) return AccessLevel.Write;
    const value = access.modules?.[module];
    return typeof value === "number" ? value : AccessLevel.Write;
  }

  return {
    access,
    isLoading: query.isPending && !!activeCompanyId,
    isStaff: access?.isStaff ?? false,
    canSee: (module) => level(module) > AccessLevel.None,
    canWrite: (module) => level(module) >= AccessLevel.Write,
  };
}
