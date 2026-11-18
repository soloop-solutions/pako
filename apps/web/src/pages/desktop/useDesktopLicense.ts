import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { getDesktopBridge } from "@/lib/desktopBridge";

export const LICENSE_KEY = ["desktop", "license"] as const;

export const EXPIRY_WARNING_DAYS = 30;

export const LICENSE_REFRESH_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function useDesktopLicense() {
  const enabled = getDesktopBridge() !== null;
  const query = useQuery({
    queryKey: LICENSE_KEY,
    queryFn: () => apiClient.getDesktopLicense(),
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: LICENSE_REFRESH_MS,
  });
  return { enabled, data: enabled ? query.data : undefined };
}

export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.ceil((at - now) / DAY_MS);
}
