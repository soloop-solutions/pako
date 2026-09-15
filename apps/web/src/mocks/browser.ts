// PROVISIONAL — see src/mocks/handlers.ts, src/mocks/lockDatesHandlers.ts and
// src/mocks/itemTypesHandlers.ts for why these exist and how to remove them. Three independent
// mock domains (F2 accounts, F3 lock dates, F5 item type), each gated by its own flag — combined
// here only because a page can register at most one Service Worker.
import { setupWorker } from "msw/browser";

import { handlers } from "@/mocks/handlers";
import { itemTypesHandlers } from "@/mocks/itemTypesHandlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";

export const worker = setupWorker(...handlers, ...lockDatesHandlers, ...itemTypesHandlers);
