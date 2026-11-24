import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// UI/UX round 2026-11-24: a link such as `/invoicing/<id>#payment` scrolls to that section once the
// page has loaded it (the list's "Pay" action lands on the payment card).
export function useScrollToHash(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const element = document.getElementById(decodeURIComponent(hash.slice(1)));
    element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [ready, hash]);
}
