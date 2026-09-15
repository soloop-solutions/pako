// PROVISIONAL — see src/mocks/partnersHandlers.ts / itemTypesHandlers.ts / lockDatesHandlers.ts /
// costCentersHandlers.ts / attachmentsHandlers.ts for why these mocks exist and how to remove
// them. Originally written for F2's now-removed accounts mock (see git history — the F2 mock was
// deleted once B1/B2/B3 landed the real write/group-hierarchy/cash-flow-category endpoints on
// AccountsController), this file is now shared, generic worker-bootstrap infrastructure for every
// remaining mock domain (each gated by its own flag file, e.g. partnersMockFlag.ts).
//
// Only responsible for making sure the MSW browser worker is registered, lazily and exactly
// once per page load — it does NOT decide whether any given mock is currently allowed to answer a
// request. That decision is a separate, synchronous flag per domain (e.g.
// src/mocks/partnersMockFlag.ts's setPartnersMockActive), toggled directly by that domain's own
// screen on mount/unmount.
//
// Earlier version of this file tried to start/stop the worker itself around a screen's
// mount/unmount lifecycle (reference-counted, to survive React 18/19 StrictMode's synchronous
// mount1->cleanup1->mount2 double-invoke). That closed the StrictMode race but opened a second,
// worse one a live click-through caught: `worker.stop()` communicates with the Service Worker
// over an async postMessage round trip, so even a "fixed" stop could still lose a race against
// the very next route's own fetch — some other screen would occasionally still get served one
// last fake response before the stop actually landed. A plain synchronous boolean, read inside
// each domain's own handler at request-resolution time, has no such round trip to race — it is
// always current by the time any handler runs, however that request happened to be timed. See
// mockInit.test.ts for the regression coverage of this file's own idempotency guarantee.
//
// Never runs under a real Service Worker environment: `import.meta.env.DEV` is true both for
// `vite dev` and for `vitest` (jsdom has no Service Worker API), so this also checks
// `"serviceWorker" in navigator` — false under jsdom, true in a real dev-server browser tab. Tests
// don't need the browser worker anyway: src/test/setup.ts wires the equivalent `msw/node` server
// directly into vitest's fetch, independent of this file.
//
// Set VITE_DISABLE_ACCOUNTS_MOCK=true (e.g. in apps/web/.env.local) to skip starting the worker
// entirely — named after the F2 mock that originally introduced this flag, kept as-is since other
// screens' mocks now share this same bootstrap and the flag still does the same job for all of
// them; rename if this becomes confusing.

let startPromise: Promise<void> | null = null;

function mockUsable(): boolean {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_DISABLE_ACCOUNTS_MOCK === "true") return false;
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

// Idempotent and memoized — safe to call from every mount (including StrictMode's extra one)
// without registering the worker more than once. Never stops the worker: the worker running is
// harmless on its own, since every domain's handlers check their own mock-active flag (e.g.
// partnersMockFlag, itemTypesMockFlag) before answering.
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
