import { useQuery } from "@tanstack/react-query";

import { getDesktopBridge, getTillNetworkBridge } from "@/lib/desktopBridge";

export const TILL_NETWORK_KEY = ["desktop", "tillNetwork"] as const;

// Where a till device reaches this PAKO. In the browser that is the page's own address; in the
// desktop app the window runs on 127.0.0.1, which a tablet can't open, so links use this PC's
// address on the shop network ("Allow tills on this network" in Settings).
export function useTillNetwork() {
  const desktop = getDesktopBridge() !== null;
  const bridge = getTillNetworkBridge();
  const query = useQuery({
    queryKey: TILL_NETWORK_KEY,
    queryFn: () => bridge!.getTillNetwork(),
    enabled: bridge !== null,
    retry: false,
  });
  const status = query.data ?? null;
  return {
    desktop,
    bridge,
    status,
    isPending: bridge !== null && query.isPending,
    // null in the desktop app while tills are off: there is no address a tablet could open.
    baseUrl: !desktop ? window.location.origin : (status?.running && status.urls[0]) || null,
  };
}
