// PROVISIONAL — F3 (lock dates in settings) mock contract.
//
// The real `CompaniesController` (backend/Pako.Api/Controllers/CompaniesController.cs) exposes no
// write endpoint of any kind beyond `POST` (create) — no way to set a lock date at all. Two of the
// five lock dates (`AccountingLockDate`/`TaxLockDate`) already exist as real fields on `Company`
// (backend/Pako.Domain/Companies/Company.cs) and are already returned by the real `GET
// /api/companies`, but `SaleLockDate`/`PurchaseLockDate`/`HardLockDate` and the exception model
// (who/why/until-when, grant/revoke) do not exist on the backend at all. This mock invents the
// full contract for all five dates plus the exception list — GET/PUT `.../lock-dates`, POST
// `.../lock-dates/hard-lock`, GET/POST `.../lock-exceptions`, DELETE
// `.../lock-exceptions/{id}` — matching this repo's existing REST conventions (plain objects, 201
// on create, 204 on delete, 400 with a plain string body on validation failure, see
// AccountsController's actual sibling controllers).
//
// This is scaffolding to be torn out, not permanent product code:
//   1. Once the real backend lands lock-date read/write and exception-list endpoints, delete this
//      file, src/mocks/lockDatesMockFlag.ts, and src/api/lock-dates-client.ts.
//   2. Regenerate packages/shared's client and replace every call in
//      src/api/lock-dates-client.ts / LockDatesSettings.tsx with the real generated `apiClient.*`
//      methods — re-check for the usual NSwag operation-name-collision gotcha (see CLAUDE.md).
//   3. Compare the shapes below against what the real backend actually shipped, especially the
//      exception model's scope (this mock grants a blanket exception across all five lock dates
//      for one member until an expiry date — the real backend may want a narrower per-lock-type
//      grant; see LockDatesSettings.tsx's own header comment for this call).
//
// **Own flag, own handlers, deliberately NOT sharing src/mocks/handlers.ts / accountsMockFlag.ts**
// — same synchronous-flag-read-at-resolution-time discipline as the F2 accounts mock (see that
// file's header for the mount/unmount race this fixes), kept as a fully separate module per this
// task's explicit instruction so the two mocked domains can never bleed into each other. The one
// piece of infrastructure genuinely reused is `ensureAccountsMockWorkerStarted` from
// src/mocks/mockInit.ts — it only registers the browser's single Service Worker (there can be only
// one per page) and does not gate which handler answers a request, so reusing it here is
// registering the shared worker, not reusing the F2 mock's own domain logic.

import { HttpResponse, http, passthrough } from "msw";

import { API_BASE_URL } from "@/api/client";
import type { GrantLockExceptionRequest, LockDateSettings, LockException } from "@/lib/lock-dates";
import { isLockDatesMockActive, setLockDatesMockActive } from "@/mocks/lockDatesMockFlag";

const initialSettings: LockDateSettings = {
  accountingLockDate: null,
  taxLockDate: null,
  saleLockDate: null,
  purchaseLockDate: null,
  hardLockDate: null,
};

let settings: LockDateSettings = { ...initialSettings };
let exceptions: LockException[] = [];
let nextExceptionId = 1;

export function resetLockDatesMock(): void {
  settings = { ...initialSettings };
  exceptions = [];
  nextExceptionId = 1;
  setLockDatesMockActive(false);
}

function errorResponse(status: number, message: string) {
  return HttpResponse.json(message, { status });
}

interface SoftLockDateWriteBody {
  accountingLockDate?: string | null;
  taxLockDate?: string | null;
  saleLockDate?: string | null;
  purchaseLockDate?: string | null;
}

export const lockDatesHandlers = [
  http.get(`${API_BASE_URL}/api/companies/:companyId/lock-dates`, () => {
    if (!isLockDatesMockActive()) return passthrough();
    return HttpResponse.json(settings);
  }),

  http.put(`${API_BASE_URL}/api/companies/:companyId/lock-dates`, async ({ request }) => {
    if (!isLockDatesMockActive()) return passthrough();
    const body = (await request.json()) as SoftLockDateWriteBody;
    settings = {
      ...settings,
      accountingLockDate: body.accountingLockDate ?? null,
      taxLockDate: body.taxLockDate ?? null,
      saleLockDate: body.saleLockDate ?? null,
      purchaseLockDate: body.purchaseLockDate ?? null,
    };
    return HttpResponse.json(settings);
  }),

  http.post(`${API_BASE_URL}/api/companies/:companyId/lock-dates/hard-lock`, async ({ request }) => {
    if (!isLockDatesMockActive()) return passthrough();
    const body = (await request.json()) as { hardLockDate?: string };
    if (settings.hardLockDate) {
      return errorResponse(400, "The hard lock is already set and cannot be changed or removed.");
    }
    if (!body.hardLockDate) {
      return errorResponse(400, "A date is required to set the hard lock.");
    }
    settings = { ...settings, hardLockDate: body.hardLockDate };
    return HttpResponse.json(settings);
  }),

  http.get(`${API_BASE_URL}/api/companies/:companyId/lock-exceptions`, () => {
    if (!isLockDatesMockActive()) return passthrough();
    return HttpResponse.json(exceptions);
  }),

  http.post(`${API_BASE_URL}/api/companies/:companyId/lock-exceptions`, async ({ request }) => {
    if (!isLockDatesMockActive()) return passthrough();
    const body = (await request.json()) as GrantLockExceptionRequest;

    if (!body.memberUserId) return errorResponse(400, "Select a member to grant the exception to.");
    if (!body.reason?.trim()) return errorResponse(400, "A reason is required.");
    if (!body.until) return errorResponse(400, "An expiry date is required.");

    const exception: LockException = {
      id: String(nextExceptionId++),
      memberUserId: body.memberUserId,
      memberEmail: body.memberEmail,
      reason: body.reason.trim(),
      until: body.until,
      grantedByEmail: body.grantedByEmail,
      grantedAt: new Date().toISOString(),
    };
    exceptions = [...exceptions, exception];
    return HttpResponse.json(exception, { status: 201 });
  }),

  http.delete(`${API_BASE_URL}/api/companies/:companyId/lock-exceptions/:exceptionId`, ({ params }) => {
    if (!isLockDatesMockActive()) return passthrough();
    const existing = exceptions.find((e) => e.id === params.exceptionId);
    if (!existing) return errorResponse(404, "Exception not found.");
    exceptions = exceptions.filter((e) => e.id !== params.exceptionId);
    return new HttpResponse(null, { status: 204 });
  }),
];
