// PROVISIONAL — F6 (partner register) mock contract.
//
// The real `PartnersController` now supports GET/POST/PUT and the real `Partner` entity has
// `ControlAccountId`, `PaymentTermDays` and `CreditLimit` fields. This mock still exists because
// the PUT path here augments the GET response with mock-only overrides (withMockFields) for test
// isolation — once the frontend is fully wired to the real generated `apiClient.*` methods for
// partner editing, this file and src/mocks/partnersMockFlag.ts can be deleted.
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
