import { describe, it } from "vitest";

// Partner mock handlers are no longer active — PartnersController now has a real PUT endpoint
// with all fields (receivableAccountId, payableAccountId, paymentTermDays, creditLimit).
// The mock PUT tests are removed; partner editing is tested via:
//   - backend/Pako.Tests/PartnersControllerTests.cs (Update_ChangesSubledgerFields, etc.)
//   - apps/web/src/pages/partners/Partners.test.tsx (edits a partner via the real PUT endpoint)

describe("partnersHandlers (retired)", () => {
  it("partner editing now uses the real backend PUT endpoint", () => {
    // No mock to test — this file is kept only to document the transition.
  });
});
