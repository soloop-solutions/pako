// PROVISIONAL — see src/mocks/costCentersHandlers.ts for
// why this exists and how to remove them. F6 partner mock removed — PartnersController now has a
// real PUT endpoint and all fields (receivableAccountId, payableAccountId, paymentTermDays,
// creditLimit) are on the real domain entity.
import { setupWorker } from "msw/browser";

import { costCentersHandlers } from "@/mocks/costCentersHandlers";

export const worker = setupWorker(
  ...costCentersHandlers,
);
