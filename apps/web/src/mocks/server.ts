// PROVISIONAL — see src/mocks/lockDatesHandlers.ts, src/mocks/partnersHandlers.ts,
// src/mocks/costCentersHandlers.ts and src/mocks/attachmentsHandlers.ts for why these exist and
// how to remove them. Used by src/test/setup.ts so vitest exercises the same F3/F6/F9/F11 mock
// contracts as the dev browser. F2's own accounts mock and F5's item-type mock were both removed
// once the real backend landed the fields they stood in for (B1/B2/B3, B6).
import { setupServer } from "msw/node";

import { attachmentsHandlers } from "@/mocks/attachmentsHandlers";
import { costCentersHandlers } from "@/mocks/costCentersHandlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";
import { partnersHandlers } from "@/mocks/partnersHandlers";

export const server = setupServer(
  ...lockDatesHandlers,
  ...partnersHandlers,
  ...costCentersHandlers,
  ...attachmentsHandlers,
);
