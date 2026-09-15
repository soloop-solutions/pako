import { afterEach, describe, expect, it } from "vitest";

// Own lifecycle tests for the F6 partner mock's synchronous flag + in-memory override store —
// same discipline mockInit.test.ts already applies to the shared worker-start plumbing (idempotent,
// safe under repeated calls), scoped here to what's actually specific to this mock: the flag flips
// synchronously (no promise round trip to race, see accountsMockFlag.ts's header for the race this
// closes) and the override store merges rather than replaces on repeated writes.

import {
  getPartnerMockFields,
  isPartnersMockActive,
  resetPartnersMock,
  setPartnerMockFields,
  setPartnersMockActive,
} from "@/mocks/partnersMockFlag";

describe("partnersMockFlag", () => {
  afterEach(() => {
    resetPartnersMock();
  });

  it("is inactive by default", () => {
    expect(isPartnersMockActive()).toBe(false);
  });

  it("flips synchronously, no async work involved", () => {
    setPartnersMockActive(true);
    expect(isPartnersMockActive()).toBe(true);
    setPartnersMockActive(false);
    expect(isPartnersMockActive()).toBe(false);
  });

  it("has no stored fields for an id that was never written", () => {
    expect(getPartnerMockFields("unknown-id")).toBeUndefined();
  });

  it("stores and returns fields for a given partner id", () => {
    setPartnerMockFields("p1", { controlAccountId: "acc-1", paymentTermDays: 30, creditLimit: 5000 });
    expect(getPartnerMockFields("p1")).toEqual({ controlAccountId: "acc-1", paymentTermDays: 30, creditLimit: 5000 });
  });

  it("merges a second partial write onto the first rather than replacing it", () => {
    setPartnerMockFields("p1", { controlAccountId: "acc-1", paymentTermDays: 30, creditLimit: 5000 });
    setPartnerMockFields("p1", { creditLimit: 9000 });
    expect(getPartnerMockFields("p1")).toEqual({ controlAccountId: "acc-1", paymentTermDays: 30, creditLimit: 9000 });
  });

  it("keeps separate partners' stored fields independent", () => {
    setPartnerMockFields("p1", { controlAccountId: "acc-1" });
    setPartnerMockFields("p2", { controlAccountId: "acc-2" });
    expect(getPartnerMockFields("p1")).toEqual({ controlAccountId: "acc-1" });
    expect(getPartnerMockFields("p2")).toEqual({ controlAccountId: "acc-2" });
  });

  it("resetPartnersMock clears both the store and the flag", () => {
    setPartnersMockActive(true);
    setPartnerMockFields("p1", { controlAccountId: "acc-1" });

    resetPartnersMock();

    expect(isPartnersMockActive()).toBe(false);
    expect(getPartnerMockFields("p1")).toBeUndefined();
  });
});
