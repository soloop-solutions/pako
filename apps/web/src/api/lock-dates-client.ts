// PROVISIONAL — F3 lock-dates + lock-exceptions write endpoints.
//
// `packages/shared/src/generated/api-client.ts` has no lock-date read/write methods and no
// exception-list methods at all — `CompaniesController` only exposes `POST`/`GET` (create/list),
// confirmed by reading it directly (backend/Pako.Api/Controllers/CompaniesController.cs). Two of
// the five lock dates (`accountingLockDate`/`taxLockDate`) are real fields already returned by the
// real `GET /api/companies` (see `CompanyResponse` in the generated client), but there is no write
// endpoint for them either. `saleLockDate`/`purchaseLockDate`/`hardLockDate` and the exception
// model do not exist on the backend at all. Per docs/FRONTEND_BRIEF.md rule 3 ("build against
// fixtures") and this task's explicit instruction, this file mocks the full contract — same
// pattern as src/api/accounts-v2-client.ts for F2, kept as its own parallel file/mock rather than
// extending that one, per this task's instruction to keep the two mocked domains independent.
//
// Delete this file once the backend lands real lock-date read/write and exception-list endpoints
// on `CompaniesController` (or a dedicated controller) and `pnpm generate:api-client` produces real
// methods for them — replace every call site (LockDatesSettings.tsx) with the generated
// `apiClient.*` equivalents and remove src/mocks/lockDatesHandlers.ts /
// src/mocks/lockDatesMockFlag.ts at the same time.

import { API_BASE_URL, authorizedFetch } from "@/api/client";
import type { GrantLockExceptionRequest, LockDateSettings, LockException } from "@/lib/lock-dates";

async function readJsonOrThrow<T>(response: Response): Promise<T> {
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
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function getLockDates(companyId: string): Promise<LockDateSettings> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/lock-dates`);
  return readJsonOrThrow<LockDateSettings>(response);
}

export type SoftLockDateFields = Omit<LockDateSettings, "hardLockDate">;

export async function updateSoftLockDates(companyId: string, fields: SoftLockDateFields): Promise<LockDateSettings> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/lock-dates`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return readJsonOrThrow<LockDateSettings>(response);
}

export async function setHardLockDate(companyId: string, hardLockDate: string): Promise<LockDateSettings> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/lock-dates/hard-lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hardLockDate }),
  });
  return readJsonOrThrow<LockDateSettings>(response);
}

export async function listLockExceptions(companyId: string): Promise<LockException[]> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/lock-exceptions`);
  return readJsonOrThrow<LockException[]>(response);
}

export async function grantLockException(companyId: string, request: GrantLockExceptionRequest): Promise<LockException> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/lock-exceptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return readJsonOrThrow<LockException>(response);
}

export async function revokeLockException(companyId: string, exceptionId: string): Promise<void> {
  const response = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/lock-exceptions/${exceptionId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}.`);
  }
}
