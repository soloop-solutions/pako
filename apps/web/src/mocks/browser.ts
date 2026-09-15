// PROVISIONAL — see src/mocks/handlers.ts, src/mocks/lockDatesHandlers.ts,
// src/mocks/itemTypesHandlers.ts, src/mocks/partnersHandlers.ts, src/mocks/costCentersHandlers.ts
// and src/mocks/attachmentsHandlers.ts for why these exist and how to remove them. Six independent
// mock domains (F2 accounts, F3 lock dates, F5 item type, F6 partner, F9 cost center, F11
// attachments), each gated by its own flag — combined here only because a page can register at
// most one Service Worker.
import { setupWorker } from "msw/browser";

import { attachmentsHandlers } from "@/mocks/attachmentsHandlers";
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
  ...attachmentsHandlers,
);
