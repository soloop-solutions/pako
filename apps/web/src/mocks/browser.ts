// PROVISIONAL — see src/mocks/handlers.ts for why this exists and how to remove it.
import { setupWorker } from "msw/browser";

import { handlers } from "@/mocks/handlers";

export const worker = setupWorker(...handlers);
