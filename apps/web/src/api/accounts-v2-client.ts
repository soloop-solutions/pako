// PROVISIONAL — F2 chart-of-accounts write endpoints.
//
// `packages/shared/src/generated/api-client.ts` has no create/update/deactivate methods for
// accounts because the real `AccountsController` doesn't have those actions yet (only a
// read-only `GET .../accounts` exists today — see backend/Pako.Api/Controllers/AccountsController.cs
// and backend/Pako.Api/Contracts/AccountContracts.cs). Rule 2 in docs/FRONTEND_BRIEF.md ("all data
// access goes through the generated client") assumes a contract that has already landed as a real
// endpoint; here there is none yet, so this file exists only to unblock F2 against the mock in
// src/mocks/handlers.ts, per the F2 task's explicit instruction to derive and mock the missing
// write contract from the real `Account` domain entity.
//
// Delete this file once the backend lands real Create/Update/Deactivate actions on
// `AccountsController` and `pnpm generate:api-client` produces real methods for them — replace
// every call site (ChartOfAccounts.tsx) with the generated `apiClient.*` equivalents and remove
// src/mocks/handlers.ts's account write handlers at the same time.

import { API_BASE_URL, authorizedFetch } from "@/api/client";
import type { AccountV2 } from "@/lib/account-v2";

export interface AccountV2WriteFields {
  name: string;
  nameSq: string | null;
  normalBalance: number;
  subledger: number;
  isPostable: boolean;
  isControl: boolean;
  defaultVatCode: string | null;
  citDeductibility: number;
  citLimitRule: string | null;
  profiles: number;
}

export interface CreateAccountV2Request extends AccountV2WriteFields {
  code: string;
}

export type UpdateAccountV2Request = AccountV2WriteFields;

async function readAccountOrThrow(response: Response): Promise<AccountV2> {
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
  return JSON.parse(text) as AccountV2;
}

export async function createAccountV2(companyId: string, request: CreateAccountV2Request): Promise<AccountV2> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return readAccountOrThrow(response);
}

export async function updateAccountV2(companyId: string, accountId: string, request: UpdateAccountV2Request): Promise<AccountV2> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/accounts/${accountId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return readAccountOrThrow(response);
}

export async function deactivateAccountV2(companyId: string, accountId: string): Promise<AccountV2> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/accounts/${accountId}/deactivate`, {
    method: "POST",
  });
  return readAccountOrThrow(response);
}
