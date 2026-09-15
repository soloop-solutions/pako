import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

// PROVISIONAL — F2's mock accounts contract (src/mocks/handlers.ts), F3's mock lock-dates
// contract (src/mocks/lockDatesHandlers.ts), F5's mock item-type contract
// (src/mocks/itemTypesHandlers.ts) and F6's mock partner contract
// (src/mocks/partnersHandlers.ts); remove each alongside its own mock.
import { resetAccountsMock } from "@/mocks/handlers";
import { resetItemTypesMock } from "@/mocks/itemTypesMockFlag";
import { resetLockDatesMock } from "@/mocks/lockDatesHandlers";
import { resetPartnersMock } from "@/mocks/partnersMockFlag";
import { server } from "@/mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  resetAccountsMock();
  resetLockDatesMock();
  resetItemTypesMock();
  resetPartnersMock();
});
afterAll(() => server.close());
