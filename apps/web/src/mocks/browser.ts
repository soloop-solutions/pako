// PROVISIONAL — see src/mocks/costCentersHandlers.ts and src/mocks/attachmentsHandlers.ts for
// why these exist and how to remove them. F6 partner mock removed — PartnersController now has a
// real PUT endpoint and all fields (receivableAccountId, payableAccountId, paymentTermDays,
// creditLimit) are on the real domain entity.
import { setupWorker } from "msw/browser";

import { attachmentsHandlers } from "@/mocks/attachmentsHandlers";
import { costCentersHandlers } from "@/mocks/costCentersHandlers";

export const worker = setupWorker(
  ...costCentersHandlers,
  ...attachmentsHandlers,
);
