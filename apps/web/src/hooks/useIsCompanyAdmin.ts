import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { isCompanyAdminRole } from "@/lib/membership-enums";

function useSignedInUserId(): string | undefined {
  try {
    return useAuth().auth?.userId;
  } catch {
    return undefined;
  }
}

export function useIsCompanyAdmin(companyId: string | null | undefined): { isAdmin: boolean; isLoading: boolean } {
  const userId = useSignedInUserId();
  const query = useQuery({
    queryKey: ["members", "company", companyId],
    queryFn: () => apiClient.membersAll(companyId as string),
    enabled: !!companyId,
  });
  const membership = (query.data ?? []).find((m) => userId !== undefined && m.userId === userId);
  return {
    isAdmin: membership ? isCompanyAdminRole(membership.role) : false,
    isLoading: !!companyId && query.isPending,
  };
}
