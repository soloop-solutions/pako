import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { OnHandHint, WarehouseField } from "@/pages/inventory/StockFields";
import { StockReports } from "@/pages/inventory/StockReports";
import { Warehouses } from "@/pages/inventory/Warehouses";

// docs/INVENTORY_PLAN.md — the stock screens against a mocked generated client.
const listWarehouses = vi.fn();
const createWarehouse = vi.fn();
const getStockSettings = vi.fn();
const getStockValuation = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listWarehouses: (...args: unknown[]) => listWarehouses(...args),
      createWarehouse: (...args: unknown[]) => createWarehouse(...args),
      getStockSettings: (...args: unknown[]) => getStockSettings(...args),
      getStockValuation: (...args: unknown[]) => getStockValuation(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const MAIN = { id: "wh-1", code: "MAIN", name: "Magazina kryesore", address: undefined, isActive: true, isDefault: true };
const SHOP = { id: "wh-2", code: "SHOP", name: "Shop", address: "Prizren", isActive: true, isDefault: false };

function renderWith(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Stock fields", () => {
  beforeEach(() => listWarehouses.mockReset());

  it("shows quantity on hand, and warns when a sale asks for more", () => {
    const { rerender } = renderWith(<OnHandHint onHand={5} requested={3} warnWhenShort />);
    expect(screen.getByText("In stock: 5")).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <IntlProviderWrapper>
          <QueryClientProvider client={new QueryClient()}>
            <OnHandHint onHand={5} requested={8} warnWhenShort />
          </QueryClientProvider>
        </IntlProviderWrapper>
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Only 5 in stock");
  });

  it("hides the warehouse picker while there is only one warehouse", async () => {
    listWarehouses.mockResolvedValue([MAIN]);
    renderWith(<WarehouseField id="wh" value="" onChange={() => {}} />);
    await waitFor(() => expect(listWarehouses).toHaveBeenCalled());
    expect(screen.queryByText("Warehouse")).not.toBeInTheDocument();
  });

  it("shows the warehouse picker once there are two", async () => {
    listWarehouses.mockResolvedValue([MAIN, SHOP]);
    renderWith(<WarehouseField id="wh" value="" onChange={() => {}} />);
    expect(await screen.findByText("Warehouse")).toBeInTheDocument();
  });
});

describe("Warehouses", () => {
  beforeEach(() => {
    listWarehouses.mockReset();
    createWarehouse.mockReset();
    getStockSettings.mockReset();
    listWarehouses.mockResolvedValue([MAIN, SHOP]);
    getStockSettings.mockResolvedValue({ costMethod: 0, costMethodSince: "2026-01-01", costMethodLocked: true, negativeStock: 0, defaultWarehouseId: "wh-1" });
  });

  it("lists warehouses with the default marked, and the locked cost method", async () => {
    renderWith(<Warehouses />);
    expect(await screen.findByText("Magazina kryesore")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(await screen.findByText("Locked: stock has already moved under this method.")).toBeInTheDocument();
  });

  it("creates a warehouse", async () => {
    createWarehouse.mockResolvedValue({ ...SHOP, id: "wh-3", code: "PZ", name: "Prizren" });
    renderWith(<Warehouses />);
    fireEvent.click(await screen.findByRole("button", { name: /New warehouse/ }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: " PZ " } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Prizren" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(createWarehouse).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111",
      { code: "PZ", name: "Prizren", address: undefined, isActive: true }));
  });
});

describe("Stock reports", () => {
  beforeEach(() => getStockValuation.mockReset());

  it("shows the ledger difference as returned, with a warning", async () => {
    getStockValuation.mockResolvedValue({
      asOf: "2026-10-31", stockValue: 1000, ledgerValue: 1050, difference: 50,
      items: [{ itemId: "i1", itemCode: 1, itemName: "Laptop", unit: "copë", quantity: 10, averageCost: 100, value: 1000 }],
      accounts: [{ accountId: "a1", code: "120100", name: "Goods for Sale", stockValue: 1000, ledgerValue: 1050 }],
    });
    renderWith(<StockReports />);
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText(/Stock and ledger don't agree/)).toBeInTheDocument();
    expect(screen.getByText("120100 Goods for Sale")).toBeInTheDocument();
  });
});
