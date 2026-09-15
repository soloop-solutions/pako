// PROVISIONAL — see src/mocks/handlers.ts, src/mocks/lockDatesHandlers.ts,
// src/mocks/itemTypesHandlers.ts, src/mocks/partnersHandlers.ts and
// src/mocks/costCentersHandlers.ts for why these exist and how to remove them. Five independent
// mock domains (F2 accounts, F3 lock dates, F5 item type, F6 partner, F9 cost center), each gated
// by its own flag — combined here only because a page can register at most one Service Worker.
import { setupWorker } from "msw/browser";

import { costCentersHandlers } from "@/mocks/costCentersHandlers";
import { handlers } from "@/mocks/handlers";
import { itemTypesHandlers } from "@/mocks/itemTypesHandlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";
import { partnersHandlers } from "@/mocks/partnersHandlers";

export const worker = setupWorker(
  ...handlers,
  ...lockDatesHandlers,
  ...itemTypesHandlers,
  ...partnersHandlers,
  ...costCentersHandlers,
);
