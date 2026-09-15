// PROVISIONAL — see src/mocks/handlers.ts, src/mocks/lockDatesHandlers.ts,
// src/mocks/itemTypesHandlers.ts and src/mocks/partnersHandlers.ts for why these exist and how to
// remove them. Used by src/test/setup.ts so vitest exercises the same F2/F3/F5/F6 mock contracts
// as the dev browser.
import { setupServer } from "msw/node";

import { handlers } from "@/mocks/handlers";
import { itemTypesHandlers } from "@/mocks/itemTypesHandlers";
import { lockDatesHandlers } from "@/mocks/lockDatesHandlers";
import { partnersHandlers } from "@/mocks/partnersHandlers";

export const server = setupServer(...handlers, ...lockDatesHandlers, ...itemTypesHandlers, ...partnersHandlers);
