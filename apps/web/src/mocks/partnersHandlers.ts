// PROVISIONAL — F6 (partner register) mock contract.
//
// The real `PartnersController` (backend/Pako.Api/Controllers/PartnersController.cs) only exposes
// `GET`/`POST` — no edit endpoint of any kind. The real `Partner` entity
// (backend/Pako.Domain/Companies/Partner.cs) also has no `ControlAccountId`/`PaymentTermDays`/
// `CreditLimit` fields. This mock is therefore two different shapes glued together, not one:
//
//   - GET .../partners wraps the REAL endpoint (bypass + real fetch, same technique
//     src/mocks/itemTypesHandlers.ts already established for F5) and splices the 3 mocked fields
//     (plus, if this partner was ever edited through the mocked PUT below, the edited values of
//     the 5 real fields too — see withMockFields) onto each real partner in the response.
//   - PUT .../partners/:partnerId is FULLY invented (closer to src/mocks/handlers.ts's F2
//     accounts create/update mock than to itemTypesHandlers.ts) — there is no real edit endpoint
//     of any kind to wrap, so this never touches the real backend at all. It stores the complete
//     8-field record in src/mocks/partnersMockFlag.ts, which then wins entirely over the (frozen,
//     create-time) real GET response for that partner's id.
//
// This is scaffolding to be torn out, not permanent product code:
//   1. Once the real backend adds ControlAccountId/PaymentTermDays/CreditLimit to `Partner` (or
//      the product drops the requirement) AND lands a real PUT/edit action, delete this file and
//      src/mocks/partnersMockFlag.ts, remove both from src/mocks/browser.ts / src/mocks/server.ts,
//      remove src/api/partners-client.ts, and replace every call in Partners.tsx with the real
//      generated `apiClient.*` methods.
//   2. The 5 real fields (name/taxNumber/isCustomer/isVendor/fiscalNumber/isVatRegistered) are
//      genuinely editable today ONLY through this mock's PUT — once a real PUT/PATCH exists on
//      `PartnersController`, split the write path back into "real fields via the generated
//      client" + "3 mocked fields via a slimmer mock", the same shape F5's item-type mock uses.
//
// **Gated by a synchronous flag, own and separate from every other mock's** — see
// src/mocks/accountsMockFlag.ts's header for the mount/unmount + route-transition races this
// discipline closes, and src/mocks/partnersMockFlag.ts for why the flag/store live in their own
// tiny module. Every handler below reads the flag fresh at request-resolution time and calls
// `passthrough()` when inactive, so this mock only ever answers while the Partners register is
// genuinely on screen.

import { HttpResponse, bypass, http, passthrough } from "msw";

import { API_BASE_URL } from "@/api/client";
import { getPartnerMockFields, isPartnersMockActive, setPartnerMockFields, type PartnerMockFields } from "@/mocks/partnersMockFlag";

interface RawPartner {
  id: string;
  [key: string]: unknown;
}

function withMockFields(partner: RawPartner): RawPartner {
  const override = getPartnerMockFields(partner.id);
  return {
    ...partner,
    controlAccountId: null,
    paymentTermDays: null,
    creditLimit: null,
    ...override,
  };
}

interface PartnerWriteBody {
  name?: string;
  taxNumber?: string | null;
  isCustomer?: boolean;
  isVendor?: boolean;
  fiscalNumber?: string | null;
  isVatRegistered?: boolean;
  controlAccountId?: string | null;
  paymentTermDays?: number | null;
  creditLimit?: number | null;
}

function errorResponse(status: number, message: string) {
  return HttpResponse.json(message, { status });
}

export const partnersHandlers = [
  http.get(`${API_BASE_URL}/api/companies/:companyId/partners`, async ({ request }) => {
    if (!isPartnersMockActive()) return passthrough();
    const response = await fetch(bypass(request));
    if (!response.ok) return response;
    const data = (await response.json()) as RawPartner[];
    return HttpResponse.json(data.map(withMockFields), { status: response.status });
  }),

  http.put(`${API_BASE_URL}/api/companies/:companyId/partners/:partnerId`, async ({ request, params }) => {
    if (!isPartnersMockActive()) return passthrough();
    const body = (await request.json()) as PartnerWriteBody;

    if (!body.name?.trim()) return errorResponse(400, "Partner name is required.");
    if (!body.isCustomer && !body.isVendor) {
      return errorResponse(400, "A partner must be a customer, a vendor, or both.");
    }
    if (body.fiscalNumber && body.fiscalNumber.length > 64) {
      return errorResponse(400, "Fiscal number must be 64 characters or fewer.");
    }
    if (body.paymentTermDays != null && body.paymentTermDays < 0) {
      return errorResponse(400, "Payment terms cannot be negative.");
    }
    if (body.creditLimit != null && body.creditLimit < 0) {
      return errorResponse(400, "Credit limit cannot be negative.");
    }

    const partnerId = params.partnerId as string;
    const updated: PartnerMockFields = {
      name: body.name.trim(),
      taxNumber: body.taxNumber?.trim() || null,
      isCustomer: body.isCustomer ?? false,
      isVendor: body.isVendor ?? false,
      fiscalNumber: body.fiscalNumber?.trim() || null,
      isVatRegistered: body.isVatRegistered ?? false,
      controlAccountId: body.controlAccountId || null,
      paymentTermDays: body.paymentTermDays ?? null,
      creditLimit: body.creditLimit ?? null,
    };
    setPartnerMockFields(partnerId, updated);

    return HttpResponse.json({ id: partnerId, ...updated });
  }),
];
