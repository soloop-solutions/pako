import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

// jsdom 26 + Node 22 may not expose localStorage as a global; provide a minimal polyfill
// if it's missing so tests that use localStorage.clear() / getItem / setItem can run.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}

// PROVISIONAL — F9's mock cost-center contract (src/mocks/costCentersHandlers.ts); remove it
// alongside its mock. F11's attachments mock was removed once the real AttachmentsController landed.
// F6 partner mock removed — Partners.tsx now calls the real generated apiClient methods directly.
import { resetCostCentersMock } from "@/mocks/costCentersMockFlag";
import { server } from "@/mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  resetCostCentersMock();
});
afterAll(() => server.close());
