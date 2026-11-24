import { useEffect, useSyncExternalStore } from "react";

// Whether a PageHeader is on screen — the layout's breadcrumb row steps aside for it, since the
// header shows the section itself (user request 2026-11-24).
let mounted = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePageHeaderMounted(): boolean {
  return useSyncExternalStore(subscribe, () => mounted > 0);
}

export function useRegisterPageHeader() {
  useEffect(() => {
    mounted += 1;
    notify();
    return () => {
      mounted -= 1;
      notify();
    };
  }, []);
}
