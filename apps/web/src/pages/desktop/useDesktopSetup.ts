import { useQuery } from "@tanstack/react-query";
import { ApiException } from "@pako/shared";

import { apiClient } from "@/api/client";
import { getDesktopBridge } from "@/lib/desktopBridge";

export const DESKTOP_SETUP_KEY = ["desktop", "setup"] as const;

export function useDesktopSetup() {
  const enabled = getDesktopBridge() !== null;
  const query = useQuery({
    queryKey: DESKTOP_SETUP_KEY,
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      try {
        const status = await apiClient.getDesktopSetup();
        return { needsSetup: status.needsSetup, available: true };
      } catch (err) {
        if (err instanceof ApiException && err.status === 404) return { needsSetup: false, available: false };
        throw err;
      }
    },
  });
  return {
    enabled,
    available: enabled && query.data?.available === true,
    loading: enabled && query.isPending,
    needsSetup: enabled && query.data?.needsSetup === true,
  };
}
