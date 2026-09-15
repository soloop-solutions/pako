// PROVISIONAL — F5 item `type` mock (goods/service/normative).
//
// The real `Item` entity (backend/Pako.Domain/Companies/Item.cs) has no type classification field
// at all, and `ItemsController` already has real, working GET/POST/PUT endpoints — unlike the F2
// (accounts) and F3 (lock dates) mocks in this same directory, this one does NOT replace a missing
// endpoint. It wraps the real one: Items.tsx writes into src/mocks/itemTypesMockFlag.ts's
// itemId -> type map directly after a real apiClient.itemsPOST/itemsPUT call succeeds, and the two
// handlers below splice that stored value onto the real GET response — using `bypass()` to issue
// the real request and read its real response before re-shaping it, not a fabricated fixture.
//
// This is scaffolding to be torn out, not permanent product code:
//   1. Once the real backend adds a `type` field to `Item`/`ItemResponse` (or the product drops
//      the requirement), delete this file and src/mocks/itemTypesMockFlag.ts, remove both from
//      src/mocks/browser.ts / src/mocks/server.ts, and drop the `type` plumbing in Items.tsx /
//      src/lib/item-types.ts (or replace `type` there with the real generated field).
//   2. `type` is never sent to the real backend — Items.tsx calls the real apiClient.itemsPOST/
//      itemsPUT with only the six real ItemResponse fields, so removing this mock leaves item
//      create/edit fully working, just without the type column/field.
//
// **Own flag, own handlers, deliberately NOT sharing src/mocks/handlers.ts /
// src/mocks/lockDatesHandlers.ts or their flags** — same synchronous-flag-read-at-
// resolution-time discipline as those two mocks (see accountsMockFlag.ts's header for the
// mount/unmount race this fixes), kept fully separate so the three mocked domains can never bleed
// into each other. Reuses only src/mocks/mockInit.ts's `ensureAccountsMockWorkerStarted` to
// register the one shared Service Worker, same as lockDatesHandlers.ts already does — that
// function only starts the worker, it does not decide which handler answers a request.

import { HttpResponse, bypass, http, passthrough } from "msw";

import { API_BASE_URL } from "@/api/client";
import { getMockItemType, isItemTypesMockActive } from "@/mocks/itemTypesMockFlag";

interface RawItem {
  id: string;
  [key: string]: unknown;
}

function withMockType(item: RawItem): RawItem {
  return { ...item, type: getMockItemType(item.id) ?? null };
}

export const itemTypesHandlers = [
  http.get(`${API_BASE_URL}/api/companies/:companyId/items`, async ({ request }) => {
    if (!isItemTypesMockActive()) return passthrough();
    const response = await fetch(bypass(request));
    if (!response.ok) return response;
    const data = (await response.json()) as { items: RawItem[]; total: number };
    return HttpResponse.json({ ...data, items: data.items.map(withMockType) }, { status: response.status });
  }),

  http.get(`${API_BASE_URL}/api/companies/:companyId/items/:itemId`, async ({ request }) => {
    if (!isItemTypesMockActive()) return passthrough();
    const response = await fetch(bypass(request));
    if (!response.ok) return response;
    const data = (await response.json()) as RawItem;
    return HttpResponse.json(withMockType(data), { status: response.status });
  }),
];
