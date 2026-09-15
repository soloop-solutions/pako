import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

// PROVISIONAL — F2's mock accounts contract (src/mocks/handlers.ts) and F3's mock lock-dates
// contract (src/mocks/lockDatesHandlers.ts); remove each alongside its own mock.
import { resetAccountsMock } from "@/mocks/handlers";
import { resetLockDatesMock } from "@/mocks/lockDatesHandlers";
import { server } from "@/mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  resetAccountsMock();
  resetLockDatesMock();
});
afterAll(() => server.close());
