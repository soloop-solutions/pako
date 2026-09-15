// PROVISIONAL — F2 (chart of accounts) mock contract.
//
// The real `AccountsController` (backend/Pako.Api/Controllers/AccountsController.cs) only exposes
// a read-only `GET /api/companies/{companyId}/accounts` today, returning 7 of the ~20 fields on
// the real `Account` entity (backend/Pako.Domain/Ledger/Account.cs) — no create/update/deactivate
// endpoint exists yet. A separate developer is building that backend in parallel on a different
// branch. Per docs/FRONTEND_BRIEF.md rule 3 ("build against fixtures") and this task's explicit
// instruction, this file mocks the full contract — GET returns every field on the real entity, and
// POST/PUT/deactivate are invented, matching this repo's existing REST conventions (see
// PartnersController.cs/ItemsController.cs: plain arrays, 201 on create, PUT on edit, no delete for
// an entity that must never be hard-deleted).
//
// This is scaffolding to be torn out, not permanent product code:
//   1. Once the real backend lands Create/Update/Deactivate actions on AccountsController and
//      GET returns the full field set, delete src/mocks/handlers.ts, src/mocks/browser.ts,
//      src/mocks/server.ts, src/mocks/mockInit.ts, src/mocks/fixtures/accounts-v2.json, and the
//      `msw` dependency.
//   2. Regenerate packages/shared's client (`pnpm generate:api-client`) and replace every call in
//      src/api/accounts-v2-client.ts / ChartOfAccounts.tsx with the real generated `apiClient.*`
//      methods — re-check for the usual NSwag operation-name-collision gotcha (see CLAUDE.md).
//   3. Compare the shapes below against what the real backend actually shipped — they were derived
//      from the real `Account` domain entity and R25/R26 (code immutable, deactivate-never-delete),
//      not from a real contract commit, so field names should match but request/response envelope
//      details may not.
//
// The mocked GET intercepts the SAME URL the real endpoint already serves
// (`/api/companies/{companyId}/accounts`) — not a parallel path — so `apiClient.accounts()`
// (the real generated client method) keeps working unchanged once this handler is deleted and the
// real backend starts returning the full field set at that same URL.
//
// **Gated by a synchronous flag, not by whether the worker/server is merely registered.** The
// worker (src/mocks/mockInit.ts) is started once, lazily, and never stopped — so registering it
// can never race anything. Instead, ChartOfAccounts.tsx calls `setAccountsMockActive(true)`
// synchronously on mount and `setAccountsMockActive(false)` synchronously on unmount (both plain
// boolean writes, no promises) — that setter lives in src/mocks/accountsMockFlag.ts, a separate
// tiny `msw`-free module, specifically so ChartOfAccounts.tsx's static import of it doesn't pull
// this whole file (and `msw`, and the 233-row fixture) into the production bundle; only that
// tiny file needs a static import; this one stays behind the existing dynamic imports. Every
// handler below reads the flag at the moment it actually resolves a request and calls
// `passthrough()` when inactive, so this mock only ever answers while someone is genuinely
// looking at Chart of Accounts — even though request resolution itself happens asynchronously (a
// real Service Worker forwards each request to the page over postMessage), the flag is always
// read fresh at that later point, not captured at request-dispatch time, so it can't go stale
// mid-flight. A previous version tried to start/stop the worker itself around the screen's
// mount/unmount instead and lost exactly that race — see mockInit.ts's header for the full story
// and ChartOfAccounts.test.tsx / mockInit.test.ts for the regression coverage.

import { HttpResponse, http, passthrough } from "msw";

import { API_BASE_URL } from "@/api/client";
import type { AccountV2 } from "@/lib/account-v2";
import { accountClassFromCode, accountGroupFromCode, deriveAccountSubType, deriveAccountType, deriveStatement } from "@/lib/account-v2";
import { isAccountsMockActive, setAccountsMockActive } from "@/mocks/accountsMockFlag";
import seedAccounts from "@/mocks/fixtures/accounts-v2.json";

// One in-memory store, shared by every company id — the mock does not attempt real per-company
// seeding/isolation, only enough state to make add/edit/deactivate behave consistently within a
// single browser session or test run.
let accounts: AccountV2[] = structuredClone(seedAccounts) as AccountV2[];

export function resetAccountsMock(): void {
  accounts = structuredClone(seedAccounts) as AccountV2[];
  setAccountsMockActive(false);
}

function nextMockId(code: string): string {
  return `${code}-0000-4000-8000-${Date.now().toString().padStart(12, "0")}`;
}

interface AccountWriteBody {
  code?: string;
  name?: string;
  nameSq?: string | null;
  normalBalance?: number;
  subledger?: number;
  isPostable?: boolean;
  isControl?: boolean;
  defaultVatCode?: string | null;
  citDeductibility?: number;
  citLimitRule?: string | null;
  profiles?: number;
}

function errorResponse(status: number, message: string) {
  return HttpResponse.json(message, { status });
}

export const handlers = [
  http.get(`${API_BASE_URL}/api/companies/:companyId/accounts`, () => {
    if (!isAccountsMockActive()) return passthrough();
    return HttpResponse.json(accounts);
  }),

  http.post(`${API_BASE_URL}/api/companies/:companyId/accounts`, async ({ request }) => {
    if (!isAccountsMockActive()) return passthrough();
    const body = (await request.json()) as AccountWriteBody;

    if (!body.code?.trim()) return errorResponse(400, "Account code is required.");
    if (!body.name?.trim()) return errorResponse(400, "Account name is required.");
    if (body.normalBalance == null) return errorResponse(400, "Normal balance is required.");
    if (accounts.some((a) => a.code === body.code)) {
      return errorResponse(400, `An account with code "${body.code}" already exists.`);
    }

    const accountClass = accountClassFromCode(body.code);
    const group = accountGroupFromCode(body.code);
    if (accountClass == null || group == null) {
      return errorResponse(400, "Account code must be at least 2 digits.");
    }

    const accountType = deriveAccountType(accountClass, body.normalBalance);
    const account: AccountV2 = {
      id: nextMockId(body.code),
      code: body.code.trim(),
      name: body.name.trim(),
      nameSq: body.nameSq?.trim() || null,
      accountType,
      accountSubType: deriveAccountSubType(body.subledger ?? 0),
      parentAccountId: null,
      isReconcilable: body.subledger === 1,
      class: accountClass,
      group,
      statement: deriveStatement(accountType),
      normalBalance: body.normalBalance,
      subledger: body.subledger ?? 0,
      isControl: body.isControl ?? false,
      isPostable: body.isPostable ?? true,
      defaultVatCode: body.defaultVatCode?.trim() || null,
      citDeductibility: body.citDeductibility ?? 3,
      citLimitRule: body.citDeductibility === 1 ? body.citLimitRule?.trim() || null : null,
      profiles: body.profiles ?? 1,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    accounts = [...accounts, account];
    return HttpResponse.json(account, { status: 201 });
  }),

  http.put(`${API_BASE_URL}/api/companies/:companyId/accounts/:accountId`, async ({ request, params }) => {
    if (!isAccountsMockActive()) return passthrough();
    const body = (await request.json()) as AccountWriteBody;
    const existing = accounts.find((a) => a.id === params.accountId);
    if (!existing) return errorResponse(404, "Account not found.");

    if (!body.name?.trim()) return errorResponse(400, "Account name is required.");
    if (body.normalBalance == null) return errorResponse(400, "Normal balance is required.");

    const accountType = deriveAccountType(existing.class ?? 0, body.normalBalance);
    const updated: AccountV2 = {
      ...existing,
      name: body.name.trim(),
      nameSq: body.nameSq?.trim() || null,
      accountType,
      accountSubType: deriveAccountSubType(body.subledger ?? 0),
      statement: deriveStatement(accountType),
      normalBalance: body.normalBalance,
      subledger: body.subledger ?? 0,
      isControl: body.isControl ?? existing.isControl,
      isPostable: body.isPostable ?? existing.isPostable,
      defaultVatCode: body.defaultVatCode?.trim() || null,
      citDeductibility: body.citDeductibility ?? existing.citDeductibility,
      citLimitRule: body.citDeductibility === 1 ? body.citLimitRule?.trim() || null : null,
      profiles: body.profiles ?? existing.profiles,
    };

    accounts = accounts.map((a) => (a.id === updated.id ? updated : a));
    return HttpResponse.json(updated);
  }),

  http.post(`${API_BASE_URL}/api/companies/:companyId/accounts/:accountId/deactivate`, ({ params }) => {
    if (!isAccountsMockActive()) return passthrough();
    const existing = accounts.find((a) => a.id === params.accountId);
    if (!existing) return errorResponse(404, "Account not found.");

    const updated: AccountV2 = { ...existing, isActive: false };
    accounts = accounts.map((a) => (a.id === updated.id ? updated : a));
    return HttpResponse.json(updated);
  }),
];
