import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PROVISIONAL — see src/mocks/mockInit.ts's own header for why this shared worker-bootstrap
// exists and what still uses it (partners/item-types/lock-dates/cost-centers/attachments mocks —
// F2's original accounts mock that introduced this file was removed once the real backend landed).
//
// mockInit.ts no longer owns any mount-scoped start/stop lifecycle (see its header for why a
// reference-counted start/stop pair was tried and replaced) — it now only has to be idempotent:
// safe to call from every mount, including React 18/19 StrictMode's extra one, without
// registering the worker more than once. That's what this test proves. The actual mount-scoped
// gating (e.g. setPartnersMockActive) is covered in each domain's own test instead, since it only
// means anything in the context of a real handler resolving a real request.

const workerStart = vi.fn(async () => {});

vi.mock("@/mocks/browser", () => ({
  worker: {
    start: () => workerStart(),
    stop: () => {},
  },
}));

describe("ensureAccountsMockWorkerStarted", () => {
  let originalServiceWorker: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetModules();
    workerStart.mockClear();
    originalServiceWorker = Object.getOwnPropertyDescriptor(globalThis.navigator, "serviceWorker");
    Object.defineProperty(globalThis.navigator, "serviceWorker", { value: {}, configurable: true });
  });

  afterEach(() => {
    if (originalServiceWorker) {
      Object.defineProperty(globalThis.navigator, "serviceWorker", originalServiceWorker);
    } else {
      Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
    }
  });

  it("only starts the worker once even when called twice synchronously (StrictMode's mount1 -> mount2)", async () => {
    const { ensureAccountsMockWorkerStarted } = await import("@/mocks/mockInit");

    const call1 = ensureAccountsMockWorkerStarted();
    const call2 = ensureAccountsMockWorkerStarted();

    await Promise.all([call1, call2]);

    expect(workerStart).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately on later calls without starting again", async () => {
    const { ensureAccountsMockWorkerStarted } = await import("@/mocks/mockInit");

    await ensureAccountsMockWorkerStarted();
    await ensureAccountsMockWorkerStarted();
    await ensureAccountsMockWorkerStarted();

    expect(workerStart).toHaveBeenCalledTimes(1);
  });
});
