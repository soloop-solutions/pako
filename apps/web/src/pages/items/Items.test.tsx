import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Items } from "@/pages/items/Items";

// docs/POS_PLAN.md §6.1 P2: the item form's Till section against a mocked generated client.
const api = vi.hoisted(() => ({
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
  itemsPOST: vi.fn(),
  itemsPUT: vi.fn(),
  taxes: vi.fn(),
  accountsAll: vi.fn(),
  listItemCategories: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      ...Object.fromEntries(Object.keys(api).map((k) => [k, (...args: unknown[]) => api[k as keyof typeof api](...args)])),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1" }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => false, canWrite: () => true, canApprove: () => true }),
}));

const BEER = {
  id: "i3", code: 10, name: "Birrë Peja 0.5L", description: undefined, unit: "copë", type: 0, defaultTaxDefinitionId: undefined,
  defaultRevenueAccountId: undefined, defaultExpenseAccountId: undefined, defaultInventoryAccountId: undefined, defaultUnitPrice: 0.8,
  barcodes: [], plu: "12", sellByWeight: false, openPrice: false, minimumAge: 18, depositItemId: undefined,
};

function renderItems() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Items />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Item form — till fields", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.itemsGET.mockResolvedValue({ items: [BEER], total: 1 });
    api.taxes.mockResolvedValue([]);
    api.accountsAll.mockResolvedValue([]);
    api.listItemCategories.mockResolvedValue([]);
    api.itemsPOST.mockResolvedValue({ ...BEER, id: "i9" });
    api.itemsPUT.mockResolvedValue(BEER);
  });

  it("saves the PLU, minimum age and till flags of a new item", async () => {
    renderItems();
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Djathë i bardhë" } });
    fireEvent.change(within(dialog).getByLabelText("Unit"), { target: { value: "kg" } });
    fireEvent.change(within(dialog).getByLabelText("PLU"), { target: { value: "0042" } });
    fireEvent.change(within(dialog).getByLabelText("Minimum age"), { target: { value: "16" } });
    fireEvent.click(within(dialog).getByLabelText("Sold by weight"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add item" }));
    await waitFor(() =>
      expect(api.itemsPOST).toHaveBeenCalledWith("c1", expect.objectContaining({
        name: "Djathë i bardhë", unit: "kg", plu: "0042", minimumAge: 16, sellByWeight: true, openPrice: false, depositItemId: undefined,
      })),
    );
  });

  it("loads the till fields of an item and saves a cleared minimum age as none", async () => {
    renderItems();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("PLU")).toHaveValue("12");
    const age = within(dialog).getByLabelText("Minimum age");
    expect(age).toHaveValue(18);
    fireEvent.change(age, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.itemsPUT).toHaveBeenCalledWith("c1", "i3", expect.objectContaining({ plu: "12", minimumAge: undefined, sellByWeight: false })),
    );
  });
});
