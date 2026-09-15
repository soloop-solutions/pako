// PROVISIONAL — see src/mocks/handlers.ts, src/mocks/lockDatesHandlers.ts and
// src/mocks/itemTypesHandlers.ts for why these exist and how to remove them. Used by
// src/test/setup.ts so vitest exercises the same F2/F3/F5 mock contracts as the dev browser.
import { setupServer } from "msw/node";

import { handlers } from "@/mocks/handlers";
import { itemTypesHandlers } from "@/mocks/itemTypesHandlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";

export const server = setupServer(...handlers, ...lockDatesHandlers, ...itemTypesHandlers);
