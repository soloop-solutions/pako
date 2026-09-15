// PROVISIONAL — see src/mocks/handlers.ts and src/mocks/lockDatesHandlers.ts for why these exist
// and how to remove them. Two independent mock domains (F2 accounts, F3 lock dates), each gated by
// its own flag — combined here only because a page can register at most one Service Worker.
import { setupWorker } from "msw/browser";

import { handlers } from "@/mocks/handlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";

export const worker = setupWorker(...handlers, ...lockDatesHandlers);
