import { describe, expect, it } from "vitest";

// Exercises the FULLY MOCKED PUT .../partners/:partnerId handler directly against the msw/node
// server that src/test/setup.ts already wires into every test (server.listen/resetHandlers live
// there) — no React, no real backend needed, since this half of the mock never calls out to one.
// The GET half (src/mocks/partnersHandlers.ts's withMockFields) wraps the REAL backend via
// bypass()+fetch and is exercised only manually against a live Pako.Api, same gap
// src/mocks/itemTypesHandlers.ts already has with zero test coverage of its own GET-splice half —
// not retested here for the same reason: there is no live backend inside vitest to bypass to.

import { API_BASE_URL } from "@/api/client";
import { getPartnerMockFields, setPartnersMockActive } from "@/mocks/partnersMockFlag";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const PARTNER_ID = "22222222-2222-2222-2222-222222222222";

function putPartner(body: unknown) {
  return fetch(`${API_BASE_URL}/api/companies/${COMPANY_ID}/partners/${PARTNER_ID}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("partnersHandlers PUT (mocked edit)", () => {
  it("rejects a missing name", async () => {
    setPartnersMockActive(true);
    const response = await putPartner({ isCustomer: true, isVendor: false });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatch(/name is required/i);
  });

  it("rejects a partner that is neither customer nor vendor", async () => {
    setPartnersMockActive(true);
    const response = await putPartner({ name: "Acme", isCustomer: false, isVendor: false });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatch(/customer, a vendor, or both/i);
  });

  it("rejects a negative payment term / credit limit", async () => {
    setPartnersMockActive(true);
    const negativeTerm = await putPartner({ name: "Acme", isCustomer: true, isVendor: false, paymentTermDays: -1 });
    expect(negativeTerm.status).toBe(400);

    const negativeLimit = await putPartner({ name: "Acme", isCustomer: true, isVendor: false, creditLimit: -1 });
    expect(negativeLimit.status).toBe(400);
  });

  it("stores the full 8-field record and returns it, all 3 mocked fields included", async () => {
    setPartnersMockActive(true);
    const response = await putPartner({
      name: "Acme Corp",
      taxNumber: "123456789",
      isCustomer: true,
      isVendor: false,
      fiscalNumber: "987654321",
      isVatRegistered: true,
      controlAccountId: "acc-1",
      paymentTermDays: 30,
      creditLimit: 5000,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: PARTNER_ID,
      name: "Acme Corp",
      taxNumber: "123456789",
      isCustomer: true,
      isVendor: false,
      fiscalNumber: "987654321",
      isVatRegistered: true,
      controlAccountId: "acc-1",
      paymentTermDays: 30,
      creditLimit: 5000,
    });

    expect(getPartnerMockFields(PARTNER_ID)).toMatchObject({ controlAccountId: "acc-1", paymentTermDays: 30, creditLimit: 5000 });
  });

  it("a later edit overrides the earlier one entirely for the 5 real fields too", async () => {
    setPartnersMockActive(true);
    await putPartner({
      name: "Acme Corp",
      isCustomer: true,
      isVendor: false,
      isVatRegistered: true,
      controlAccountId: "acc-1",
      paymentTermDays: 30,
      creditLimit: 5000,
    });

    const second = await putPartner({
      name: "Acme Corp (renamed)",
      isCustomer: true,
      isVendor: true,
      isVatRegistered: false,
      controlAccountId: "acc-2",
      paymentTermDays: 60,
      creditLimit: 9000,
    });

    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toMatchObject({
      name: "Acme Corp (renamed)",
      isVendor: true,
      isVatRegistered: false,
      controlAccountId: "acc-2",
      paymentTermDays: 60,
      creditLimit: 9000,
    });
  });
});
