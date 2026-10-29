import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Warns the user before leaving the page when there are unsaved changes.
 * Covers:
 * - Browser close/refresh (beforeunload)
 * - Browser back/forward (popstate interception)
 * - In-app link clicks (click event interception on <a> elements)
 *
 * Note: React Router 7's useBlocker requires the data router API (createBrowserRouter),
 * but this app uses the component API (<BrowserRouter>). Instead, we intercept navigation
 * at the DOM level: popstate for back/forward, and click events on internal links.
 */
export function useUnsavedChanges(isDirty: boolean) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const navigate = useNavigate();

  // Browser close/refresh protection
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Browser back/forward protection
  useEffect(() => {
    if (!isDirty) return;

    // Push a guard entry so we can intercept the back button
    window.history.pushState({ unsavedGuard: true }, "");

    const handlePopState = () => {
      if (!dirtyRef.current) return;
      // Re-push the guard to prevent the navigation
      window.history.pushState({ unsavedGuard: true }, "");
      const leave = window.confirm("You have unsaved changes. Leave without saving?");
      if (leave) {
        dirtyRef.current = false;
        window.history.go(-2); // Go back past the guard
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      // Clean up the guard entry if component unmounts normally (after save)
      if (window.history.state?.unsavedGuard) {
        window.history.go(-1);
      }
    };
  }, [isDirty]);

  // In-app navigation protection (clicks on sidebar, breadcrumbs, etc.)
  const handleLinkClick = useCallback((e: MouseEvent) => {
    if (!dirtyRef.current) return;
    const target = (e.target as HTMLElement)?.closest("a");
    if (!target) return;
    const href = target.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("mailto:")) return;

    e.preventDefault();
    e.stopPropagation();
    const leave = window.confirm("You have unsaved changes. Leave without saving?");
    if (leave) {
      dirtyRef.current = false;
      navigate(href);
    }
  }, [navigate]);

  useEffect(() => {
    if (!isDirty) return;
    document.addEventListener("click", handleLinkClick, true); // capture phase
    return () => document.removeEventListener("click", handleLinkClick, true);
  }, [isDirty, handleLinkClick]);
}
