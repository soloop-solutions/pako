import { useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { getStoredAuth } from "@/lib/auth-storage";

/** Milliseconds before token expiry at which the warning fires. */
const WARNING_LEAD_MS = 5 * 60 * 1000;

/** How long the toast stays visible before auto-dismissing. */
const TOAST_DURATION_MS = 10_000;

/**
 * Parse the `exp` claim from a JWT without a library.
 * Returns the expiry as a Unix-seconds number, or null on any failure.
 */
function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // Base64url -> Base64
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload);
    const parsed = JSON.parse(json) as { exp?: number };
    return typeof parsed.exp === "number" ? parsed.exp : null;
  } catch {
    return null;
  }
}

/**
 * Shows a non-blocking toast ~5 minutes before the access token expires.
 * If the silent refresh succeeds (`pako:auth-refreshed`), the warning is dismissed
 * and the timer resets for the new token.
 *
 * Call once from AppLayout (or any root layout inside AuthProvider).
 */
export function useSessionWarning(): void {
  const intl = useIntl();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdRef = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    function clearTimer() {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function dismissToast() {
      if (toastIdRef.current !== undefined) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = undefined;
      }
    }

    function schedule() {
      clearTimer();
      dismissToast();

      const auth = getStoredAuth();
      if (!auth?.token) return;

      const exp = parseJwtExp(auth.token);
      if (exp === null) return;

      const expiresAtMs = exp * 1000;
      const warningAtMs = expiresAtMs - WARNING_LEAD_MS;
      const delayMs = warningAtMs - Date.now();

      // Token already past the warning window (or expired) -- nothing useful to show.
      if (delayMs <= 0) return;

      timerRef.current = setTimeout(() => {
        toastIdRef.current = toast.info(
          intl.formatMessage({ id: "session.expiringTitle" }),
          {
            description: intl.formatMessage({ id: "session.expiringDescription" }),
            duration: TOAST_DURATION_MS,
          },
        );
      }, delayMs);
    }

    // Set initial timer.
    schedule();

    // After a silent refresh succeeds, reschedule with the new token.
    function handleRefreshed() {
      schedule();
    }

    // On logout / hard expiry, clean up.
    function handleExpired() {
      clearTimer();
      dismissToast();
    }

    window.addEventListener("pako:auth-refreshed", handleRefreshed);
    window.addEventListener("pako:auth-expired", handleExpired);

    return () => {
      clearTimer();
      dismissToast();
      window.removeEventListener("pako:auth-refreshed", handleRefreshed);
      window.removeEventListener("pako:auth-expired", handleExpired);
    };
  }, [intl]);
}
