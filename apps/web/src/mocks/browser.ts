// PROVISIONAL — see src/mocks/partnersHandlers.ts, src/mocks/costCentersHandlers.ts and
// src/mocks/attachmentsHandlers.ts for why these exist and how to remove them. Three independent
// mock domains (F6 partner, F9 cost center, F11 attachments), each gated by its own flag —
// combined here only because a page can register at most one Service Worker. F2's own accounts
// mock and F5's item-type mock were both removed once the real backend landed the fields they
// stood in for (B1/B2/B3 for accounts, B6 for item type/inventory account) — Items.tsx/
// ChartOfAccounts.tsx now call the real generated client directly for those. F3's lock-dates mock
// was removed the same way once B4 landed the real locks endpoints — LockDatesSettings.tsx now
// calls apiClient.soft/hard/exceptionsAll/exceptions/revoke directly.
import { setupWorker } from "msw/browser";

import { attachmentsHandlers } from "@/mocks/attachmentsHandlers";
import { costCentersHandlers } from "@/mocks/costCentersHandlers";
import { partnersHandlers } from "@/mocks/partnersHandlers";

export const worker = setupWorker(
  ...partnersHandlers,
  ...costCentersHandlers,
  ...attachmentsHandlers,
);
