import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { useOptionalAuth } from "@/context/AuthContext";

// docs/POS_TILL_ACCESS.md §7: a till or kitchen screen signed in as a *device* sees only these
// screens — the device home, the till, the kitchen display and the ticket scanner. Anything else
// sends it back to the device home.
const DEVICE_PATHS = [/^\/device\/?$/, /^\/pos\/till\/[^/]+\/?$/, /^\/pos\/kds\/?$/, /^\/pos\/scan\/?$/];

export function isDevicePath(pathname: string): boolean {
  return DEVICE_PATHS.some((p) => p.test(pathname));
}

/** The screen a device opened last ("/pos/till/r1", "/pos/kds?store=…"), reopened after a restart. */
const LAST_SCREEN_KEY = "pako.device.lastScreen";

export function rememberDeviceScreen(path: string): void {
  try {
    localStorage.setItem(LAST_SCREEN_KEY, path);
  } catch {
    // storage blocked: the device home just asks again
  }
}

export function lastDeviceScreen(): string | null {
  try {
    const path = localStorage.getItem(LAST_SCREEN_KEY);
    return path && isDevicePath(path.split("?")[0]) && path !== "/device" ? path : null;
  } catch {
    return null;
  }
}

export interface PosDevice {
  companyId: string;
  name: string;
}

/** The device this login is, or null for a person (and while the answer loads: `isPending`). */
export function useMyPosDevice(): { device: PosDevice | null; isPending: boolean } {
  const auth = useOptionalAuth()?.auth ?? null;
  const me = useQuery({
    queryKey: ["myAccount", auth?.userId ?? null],
    queryFn: () => apiClient.getMyAccount(),
    enabled: !!auth,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const companyId = me.data?.posDeviceCompanyId;
  return {
    device: companyId ? { companyId, name: me.data?.posDeviceName ?? "" } : null,
    isPending: !!auth && me.isPending,
  };
}

/**
 * The address a device opens to connect: this app's own origin, so it works on the same network;
 * in the desktop app, this PC's till address on the shop network (see useTillNetwork).
 */
export function deviceConnectUrl(code: string, baseUrl: string = window.location.origin): string {
  return `${baseUrl.replace(/\/+$/, "")}/device/connect?code=${encodeURIComponent(code)}`;
}
