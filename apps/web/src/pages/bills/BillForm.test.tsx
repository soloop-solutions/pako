import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BillResponse } from "@pako/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { BillForm } from "@/pages/bills/BillForm";

const api = vi.hoisted(() => ({ billsPUT: vi.fn(), billsPOST: vi.fn() }));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      billsPUT: (...args: unknown[]) => api.billsPUT(...args),
      billsPOST: (...args: unknown[]) => api.billsPOST(...args),
    },
  };
});

vi.mock("@/hooks/useEntityFavorites", () => ({
  useEntityFavorites: () => ({
    pinnedIds: new Set(), autoIds: new Set(), suppressedIds: new Set(), allFavoriteIds: new Set(), loading: false,
    pin: () => {}, unpin: () => {}, suppress: () => {}, recordSelection: () => {}, isFavorite: () => false, isPinned: () => false,
    sortWithFavorites: <T,>(items: T[]) => items,
  }),
}));

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1" }) }));

const DRAFT: BillResponse = {
  id: "b1", partnerId: "p1", partnerName: "Vendor", vendorReference: undefined, issueDate: "2026-10-31", dueDate: "2026-10-31", state: "Draft",
  documentType: 0, originalBillId: undefined, journalEntryId: undefined, internalNotes: undefined, priceMode: 0,
  lines: [{
    id: "bl1", description: "Flour 25kg", quantity: 4, unitPrice: 12, taxDefinitionId: undefined, expenseAccountId: "e1",
    discountPercent: 0, itemId: "i1", purchaseOrderLineId: "pol1",
  }],
};

describe("BillForm", () => {
  beforeEach(() => {
    api.billsPUT.mockReset().mockResolvedValue(undefined);
  });

  it("keeps a draft bill's link to its purchase-order line when the draft is saved again", async () => {
    const onSaved = vi.fn();
    render(
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient()}>
          <BillForm
            companyId="c1" vendors={[{ id: "p1", name: "Mulliri", isVendor: true } as never]} taxes={[]}
            paymentMethods={[]} isVatRegistered={false} onCreated={() => {}} editingBill={DRAFT} onSaved={onSaved}
          />
        </QueryClientProvider>
      </IntlProviderWrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.billsPUT).toHaveBeenCalled());
    expect(api.billsPUT.mock.calls[0][2].lines).toEqual([expect.objectContaining({ itemId: "i1", purchaseOrderLineId: "pol1" })]);
  });

  // User decision 2026-11-24: Excel keyboard model on bill lines.
  function renderNew() {
    render(
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient()}>
          <BillForm companyId="c1" vendors={[]} taxes={[]} paymentMethods={[]} isVatRegistered={false} onCreated={() => {}} />
        </QueryClientProvider>
      </IntlProviderWrapper>,
    );
  }
  const cell = (column: string, row: number) =>
    document.querySelector<HTMLInputElement>(`[data-line-cell="${column}"][data-row="${row}"] input`);

  it("Enter moves down a column and adds a line at the end; Escape puts the cell back", async () => {
    renderNew();
    const description = cell("description", 0)!;
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: "Flour" } });
    fireEvent.keyDown(description, { key: "Escape" });
    expect(cell("description", 0)).toHaveValue("");

    const rowsBefore = document.querySelectorAll('[data-line-cell="description"]').length;
    fireEvent.keyDown(cell("description", rowsBefore - 1)!, { key: "Enter" });
    await waitFor(() => expect(document.querySelectorAll('[data-line-cell="description"]').length).toBe(rowsBefore + 1));
    expect(api.billsPOST).not.toHaveBeenCalled();
  });

  it("a block pasted from a spreadsheet fills the cells right and down, adding lines", async () => {
    renderNew();
    const start = cell("description", 0)!;
    fireEvent.paste(start, { clipboardData: { getData: () => "Flour\t4\t1,234.50\nSugar\t2\t3,5\n" } });
    await waitFor(() => expect(cell("description", 1)).toHaveValue("Sugar"));
    expect(cell("description", 0)).toHaveValue("Flour");
    expect(cell("quantity", 0)).toHaveValue(4);
    expect(cell("price", 0)).toHaveValue(1234.5);
    expect(cell("price", 1)).toHaveValue(3.5);
  });
});
