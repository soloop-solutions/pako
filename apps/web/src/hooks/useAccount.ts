import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useAuth } from "@/context/AuthContext";

export const accountQueryKey = (userId: string | undefined) => ["account", userId] as const;

// The signed-in account across companies: platform administrator or not, and the company limit
// (docs/PLATFORM_ADMIN.md). Display only — the API enforces both.
export function useAccount() {
  const { auth } = useAuth();
  return useQuery({
    queryKey: accountQueryKey(auth?.userId),
    queryFn: () => apiClient.getMyAccount(),
    enabled: !!auth,
    staleTime: 30_000,
  });
}
