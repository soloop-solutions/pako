// PROVISIONAL — see src/mocks/lockDatesHandlers.ts, src/mocks/partnersHandlers.ts,
// src/mocks/costCentersHandlers.ts and src/mocks/attachmentsHandlers.ts for why these exist and
// how to remove them. Four independent mock domains (F3 lock dates, F6 partner, F9 cost center,
// F11 attachments), each gated by its own flag — combined here only because a page can register
// at most one Service Worker. F2's own accounts mock and F5's item-type mock were both removed
// once the real backend landed the fields they stood in for (B1/B2/B3 for accounts, B6 for item
// type/inventory account) — Items.tsx/ChartOfAccounts.tsx now call the real generated client
// directly for those.
import { setupWorker } from "msw/browser";

import { attachmentsHandlers } from "@/mocks/attachmentsHandlers";
import { costCentersHandlers } from "@/mocks/costCentersHandlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";
import { partnersHandlers } from "@/mocks/partnersHandlers";

export const worker = setupWorker(
  ...lockDatesHandlers,
  ...partnersHandlers,
  ...costCentersHandlers,
  ...attachmentsHandlers,
);
