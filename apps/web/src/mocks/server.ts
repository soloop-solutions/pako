// PROVISIONAL — see src/mocks/handlers.ts for why this exists and how to remove it.
// Used by src/test/setup.ts so vitest exercises the same F2 mock contract as the dev browser.
import { setupServer } from "msw/node";

import { handlers } from "@/mocks/handlers";

export const server = setupServer(...handlers);
