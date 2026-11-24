import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BillResponse } from "@pako/shared";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { BillEditorPage } from "@/pages/bills/BillEditorPage";

// User decision 2026-11-24: bills are entered and edited on a full page, like invoices.
const api = vi.hoisted(() => ({
  partnersAll: vi.fn(),
  taxes: vi.fn(),
  paymentMethodsAll: vi.fn(),
  itemsGET: vi.fn(),
  accountsAll: vi.fn(),
  billsGET: vi.fn(),
  billsPUT: vi.fn(),
  listWarehouses: vi.fn(),
  getStockOnHand: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  const mocked = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]));
  return { ...actual, apiClient: { ...actual.apiClient, ...mocked } };
});
vi.mock("@/hooks/useEntityFavorites", () => ({
  useEntityFavorites: () => ({
    pinnedIds: new Set(), autoIds: new Set(), suppressedIds: new Set(), allFavoriteIds: new Set(), loading: false,
    pin: () => {}, unpin: () => {}, suppress: () => {}, recordSelection: () => {}, isFavorite: () => false, isPinned: () => false,
    sortWithFavorites: <T,>(items: T[]) => items,
  }),
}));
vi.mock("@/context/TabsContext", () => ({ useTabMeta: () => {} }));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isAdmin: true }, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1", activeCompany: { id: "c1", name: "Test Co", isVatRegistered: false } }),
}));

const DRAFT: BillResponse = {
  id: "b1", partnerId: "v1", partnerName: "Furnitori X", vendorReference: "F-77", issueDate: "2026-11-20", dueDate: "2026-11-30", state: "Draft",
  documentType: 0, originalBillId: undefined, journalEntryId: undefined, internalNotes: undefined, priceMode: 0,
  lines: [{ id: "l1", description: "Flour", quantity: 2, unitPrice: 10, taxDefinitionId: undefined, expenseAccountId: "e1", discountPercent: 0, itemId: undefined }],
};

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/bills/new" element={<BillEditorPage kind="bill" />} />
            <Route path="/bills/:id/edit" element={<BillEditorPage kind="bill" />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.partnersAll.mockResolvedValue([{ id: "v1", name: "Furnitori X", isVendor: true, isCustomer: false }]);
  api.taxes.mockResolvedValue([]);
  api.paymentMethodsAll.mockResolvedValue([]);
  api.itemsGET.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
  api.accountsAll.mockResolvedValue([]);
  api.billsGET.mockResolvedValue(DRAFT);
  api.billsPUT.mockResolvedValue(undefined);
  api.listWarehouses.mockResolvedValue([]);
  api.getStockOnHand.mockResolvedValue([]);
});

describe("BillEditorPage", () => {
  it("opens a new bill on its own page and Cancel goes back to the list", async () => {
    renderAt("/bills/new");
    expect(await screen.findByRole("heading", { name: "New bill" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/bills"));
  });

  it("edits a draft bill and returns to it after saving", async () => {
    renderAt("/bills/b1/edit");
    expect(await screen.findByRole("heading", { name: "Edit F-77" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.billsPUT).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/bills/b1"));
  });
});
