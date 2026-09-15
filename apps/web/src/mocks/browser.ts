// PROVISIONAL — see src/mocks/lockDatesHandlers.ts, src/mocks/itemTypesHandlers.ts,
// src/mocks/partnersHandlers.ts, src/mocks/costCentersHandlers.ts and
// src/mocks/attachmentsHandlers.ts for why these exist and how to remove them. Five independent
// mock domains (F3 lock dates, F5 item type, F6 partner, F9 cost center, F11 attachments), each
// gated by its own flag — combined here only because a page can register at most one Service
// Worker. F2's own accounts mock was removed once B1/B2/B3 landed the real write/group-hierarchy/
// cash-flow-category endpoints on AccountsController — ChartOfAccounts.tsx now calls the real
// generated client directly.
import { setupWorker } from "msw/browser";

import { attachmentsHandlers } from "@/mocks/attachmentsHandlers";
import { costCentersHandlers } from "@/mocks/costCentersHandlers";
import { itemTypesHandlers } from "@/mocks/itemTypesHandlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";
import { partnersHandlers } from "@/mocks/partnersHandlers";

export const worker = setupWorker(
  ...lockDatesHandlers,
  ...itemTypesHandlers,
  ...partnersHandlers,
  ...costCentersHandlers,
  ...attachmentsHandlers,
);
