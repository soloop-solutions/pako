import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

// PROVISIONAL — F2's mock accounts contract (src/mocks/handlers.ts); remove alongside it.
import { resetAccountsMock } from "@/mocks/handlers";
import { server } from "@/mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  resetAccountsMock();
});
afterAll(() => server.close());
