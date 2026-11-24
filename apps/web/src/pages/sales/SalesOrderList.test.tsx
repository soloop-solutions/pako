import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { SalesOrders } from "@/pages/sales/SalesOrders";

// Client request 2026-11-24: the order list's ribbon (date range, warehouse) goes to both the list
// and the totals endpoint, and the totals under the list are the server's figures.
const api = vi.hoisted(() => ({
  partnersAll: vi.fn(),
  listWarehouses: vi.fn(),
  membersAll: vi.fn(),
  listSalesOrders: vi.fn(),
  salesOrderListTotals: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  const mocked = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]));
  return { ...actual, apiClient: { ...actual.apiClient, ...mocked } };
});
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1", activeCompany: { id: "c1", name: "Pako" } }) }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { userId: "u1" } }),
  useOptionalAuth: () => ({ auth: { userId: "u1" } }),
}));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

function renderList(path = "/sales-orders") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <SalesOrders />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.partnersAll.mockResolvedValue([]);
  api.membersAll.mockResolvedValue([]);
  api.listWarehouses.mockResolvedValue([
    { id: "w1", name: "Qendrore", isActive: true },
    { id: "w2", name: "Ferizaj", isActive: true },
  ]);
  api.listSalesOrders.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  api.salesOrderListTotals.mockResolvedValue({
    count: 12, amountBeforeDiscount: 1300, discountAmount: 50, netAmount: 1059.32, taxAmount: 190.68, grossAmount: 1250, outstanding: undefined,
  });
});

describe("SalesOrders list ribbon and totals", () => {
  it("sends the ribbon's dates and warehouse to the list and the totals, and shows the server totals", async () => {
    renderList("/sales-orders?sales-orders.from=2026-11-01&sales-orders.to=2026-11-30&sales-orders.warehouseId=w2&state=1");

    await waitFor(() => expect(api.salesOrderListTotals).toHaveBeenCalledWith("c1", 1, undefined, undefined, undefined, "2026-11-01", "2026-11-30", "w2"));
    expect(api.listSalesOrders).toHaveBeenCalledWith("c1", 1, undefined, undefined, 1, 50, undefined, "2026-11-01", "2026-11-30", "w2");

    const totals = await screen.findByTestId("list-totals");
    expect(screen.getByTestId("listTotals.count")).toHaveTextContent("12");
    expect(screen.getByTestId("listTotals.gross")).toHaveTextContent("1,250.00");
    expect(screen.getByTestId("listTotals.tax")).toHaveTextContent("190.68");
    expect(totals).not.toHaveTextContent("Outstanding");
    expect(await screen.findByText("Warehouse: Ferizaj")).toBeInTheDocument();
  });

  it("a quick period refetches with that range", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 25));
    renderList();
    await waitFor(() => expect(api.salesOrderListTotals).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Last month" }));
    await waitFor(() =>
      expect(api.salesOrderListTotals).toHaveBeenLastCalledWith("c1", undefined, undefined, undefined, undefined, "2026-10-01", "2026-10-31", undefined),
    );
    vi.useRealTimers();
  });
});
