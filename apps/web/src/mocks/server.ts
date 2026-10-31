// PROVISIONAL — see src/mocks/costCentersHandlers.ts for
// why this exists and how to remove them. F6 partner mock removed — PartnersController now has a
// real PUT endpoint and all fields are on the real domain entity.
import { setupServer } from "msw/node";

import { costCentersHandlers } from "@/mocks/costCentersHandlers";

export const server = setupServer(
  ...costCentersHandlers,
);
