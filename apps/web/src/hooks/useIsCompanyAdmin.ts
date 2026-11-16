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
  const isAdmin = (query.data ?? []).some(
    (m) => userId !== undefined && m.userId === userId && isCompanyAdminRole(m.role),
  );
  return {
    isAdmin,
    isLoading: !!companyId && query.isPending,
  };
}
