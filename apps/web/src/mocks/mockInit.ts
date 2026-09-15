// PROVISIONAL — see src/mocks/handlers.ts for why this exists and how to remove it.
//
// Only responsible for making sure the MSW browser worker is registered, lazily and exactly
// once per page load — it does NOT decide whether the mock is currently allowed to answer a
// request. That decision is a separate, synchronous flag in src/mocks/handlers.ts
// (setAccountsMockActive), toggled directly by ChartOfAccounts.tsx's mount/unmount.
//
// Earlier version of this file tried to start/stop the worker itself around the screen's
// mount/unmount lifecycle (reference-counted, to survive React 18/19 StrictMode's synchronous
// mount1->cleanup1->mount2 double-invoke). That closed the StrictMode race but opened a second,
// worse one a live click-through caught: `worker.stop()` communicates with the Service Worker
// over an async postMessage round trip, so even a "fixed" stop could still lose a race against
// the very next route's own fetch (e.g. navigating Chart of Accounts -> Ledger triggers
// Ledger's account-picker fetch in the same React commit as this screen's cleanup) — Ledger
// would occasionally still get served one last fake response before the stop actually landed,
// and since Ledger has no reason to ever refetch, it would keep showing that fake data
// indefinitely. A plain synchronous boolean, read inside the handler itself at request-resolution
// time, has no such round trip to race — it is always current by the time any handler runs,
// however that request happened to be timed. See handlers.ts for the actual gating logic and
// ChartOfAccounts.test.tsx / mockInit.test.ts for the regression coverage.
//
// Never runs under a real Service Worker environment: `import.meta.env.DEV` is true both for
// `vite dev` and for `vitest` (jsdom has no Service Worker API), so this also checks
// `"serviceWorker" in navigator` — false under jsdom, true in a real dev-server browser tab. Tests
// don't need the browser worker anyway: src/test/setup.ts wires the equivalent `msw/node` server
// (same src/mocks/handlers.ts) directly into vitest's fetch, independent of this file.
//
// Set VITE_DISABLE_ACCOUNTS_MOCK=true (e.g. in apps/web/.env.local) to develop against a real
// running backend's actual accounts endpoint instead, once one exists.

let startPromise: Promise<void> | null = null;

function mockUsable(): boolean {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_DISABLE_ACCOUNTS_MOCK === "true") return false;
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

// Idempotent and memoized — safe to call from every mount (including StrictMode's extra one)
// without registering the worker more than once. Never stops the worker: the worker running is
// harmless on its own, since every handler checks setAccountsMockActive's flag before answering.
export function ensureAccountsMockWorkerStarted(): Promise<void> {
  if (!mockUsable()) return Promise.resolve();
  if (!startPromise) {
    startPromise = (async () => {
      const { worker } = await import("@/mocks/browser");
      await worker.start({ onUnhandledRequest: "bypass" });
    })();
  }
  return startPromise;
}
