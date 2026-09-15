// PROVISIONAL — F6 partner edit.
//
// `packages/shared/src/generated/api-client.ts` has no update method for partners because the
// real `PartnersController` has no edit action of any kind — only `GET`/`POST` exist today (see
// backend/Pako.Api/Controllers/PartnersController.cs). Rule 2 in docs/FRONTEND_BRIEF.md ("all
// data access goes through the generated client") assumes a contract that has already landed as a
// real endpoint; here there is none yet, so this file exists only to unblock F6's edit flow
// against the mock in src/mocks/partnersHandlers.ts.
//
// Delete this file once the backend lands a real edit action on `PartnersController` and
// `pnpm generate:api-client` produces a real method for it — replace the call site
// (Partners.tsx) with the generated `apiClient.*` equivalent and remove
// src/mocks/partnersHandlers.ts's PUT handler at the same time.

import { API_BASE_URL, authorizedFetch } from "@/api/client";
import type { PartnerV2 } from "@/lib/partners";

export interface UpdatePartnerV2Request {
  name: string;
  taxNumber: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  fiscalNumber: string | null;
  isVatRegistered: boolean;
  controlAccountId: string | null;
  paymentTermDays: number | null;
  creditLimit: number | null;
}

async function readPartnerOrThrow(response: Response): Promise<PartnerV2> {
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "string") message = parsed;
    } catch {
      // plain-text body, keep as-is
    }
    throw new Error(message || `Request failed with status ${response.status}.`);
  }
  return JSON.parse(text) as PartnerV2;
}

export async function updatePartnerV2(companyId: string, partnerId: string, request: UpdatePartnerV2Request): Promise<PartnerV2> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/partners/${partnerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return readPartnerOrThrow(response);
}
