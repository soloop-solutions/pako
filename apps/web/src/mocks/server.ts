// PROVISIONAL — see src/mocks/handlers.ts, src/mocks/lockDatesHandlers.ts,
// src/mocks/itemTypesHandlers.ts, src/mocks/partnersHandlers.ts, src/mocks/costCentersHandlers.ts
// and src/mocks/attachmentsHandlers.ts for why these exist and how to remove them. Used by
// src/test/setup.ts so vitest exercises the same F2/F3/F5/F6/F9/F11 mock contracts as the dev
// browser.
import { setupServer } from "msw/node";

import { attachmentsHandlers } from "@/mocks/attachmentsHandlers";
import { costCentersHandlers } from "@/mocks/costCentersHandlers";
import { handlers } from "@/mocks/handlers";
import { itemTypesHandlers } from "@/mocks/itemTypesHandlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";
import { partnersHandlers } from "@/mocks/partnersHandlers";

export const server = setupServer(
  ...handlers,
  ...lockDatesHandlers,
  ...itemTypesHandlers,
  ...partnersHandlers,
  ...costCentersHandlers,
  ...attachmentsHandlers,
);
