import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

// PROVISIONAL — F6's mock partner contract (src/mocks/partnersHandlers.ts), F9's mock cost-center
// contract (src/mocks/costCentersHandlers.ts) and F11's mock attachments contract
// (src/mocks/attachmentsHandlers.ts); remove each alongside its own mock. F2's mock accounts
// contract and F5's mock item-type contract were both removed once the real backend landed the
// fields they stood in for (B1/B2/B3, B6) — ChartOfAccounts.test.tsx/Items.tsx mock apiClient
// directly now, same as Partners.test.tsx. F3's mock lock-dates contract was removed the same way
// once B4 landed the real locks endpoints — LockDatesSettings.test.tsx mocks apiClient directly.
import { resetAttachmentsMock } from "@/mocks/attachmentsMockFlag";
import { resetCostCentersMock } from "@/mocks/costCentersMockFlag";
import { resetPartnersMock } from "@/mocks/partnersMockFlag";
import { server } from "@/mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  resetPartnersMock();
  resetCostCentersMock();
  resetAttachmentsMock();
});
afterAll(() => server.close());
