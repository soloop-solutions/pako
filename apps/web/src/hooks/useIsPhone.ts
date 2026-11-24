import { useSyncExternalStore } from "react";

// Phone-sized screens (below Tailwind's `md`, 768px): a waiter's phone. Screens that need a
// different layout there, not just narrower columns, switch on this. jsdom has no matchMedia,
// so tests get the desktop layout unless they stub it.
const QUERY = "(max-width: 767.98px)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const snapshot = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
