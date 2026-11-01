import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiException, type SalesOrderResponse } from "@pako/shared";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { isoToday } from "@/lib/sales-order-enums";
import { SalesOrderDetail } from "@/pages/sales/SalesOrderDetail";

// docs/POS_PLAN.md P6 — the sales order form against a mocked generated client.
const api = vi.hoisted(() => ({
  partnersAll: vi.fn(),
  taxes: vi.fn(),
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
  listWarehouses: vi.fn(),
  resolvePrices: vi.fn(),
  getCustomerCreditStatus: vi.fn(),
  createSalesOrder: vi.fn(),
  getSalesOrder: vi.fn(),
  updateSalesOrder: vi.fn(),
  confirmSalesOrder: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  const mocked = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]));
  return { ...actual, apiClient: { ...actual.apiClient, ...mocked } };
});

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1", activeCompany: { id: "c1", name: "Pako Distribution" } }) }));

const access = vi.hoisted(() => ({ approve: true }));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => access.approve }),
}));

const WATER = {
  id: "i1", code: 101, name: "Ujë 0.5L", unit: "copë", salesUnit: "pako", salesUnitFactor: 6, defaultTaxDefinitionId: "tx18",
  defaultRevenueAccountId: undefined, defaultUnitPrice: 0.5, barcodes: [], trackInventory: true,
};

const ORDER: SalesOrderResponse = {
  id: "so1", partnerId: "p1", partnerName: "Market Arbeni", state: 0, quoteNumber: undefined, number: undefined, date: "2026-11-01",
  validUntil: undefined, deliveryDate: undefined, warehouseId: undefined, customerReference: undefined, deliveryAddress: undefined,
  notes: undefined, routeVisitId: undefined, net: 22.88, vat: 4.12, total: 27, delivery: "none", invoicing: "none",
  blockOverrideReason: undefined, quotedAt: undefined, confirmedAt: undefined, documents: [],
  lines: [{
    id: "sol1", itemId: "i1", description: "Ujë 0.5L", quantity: 10, unitName: "pako", unitFactor: 6, unitPrice: 2.7, discountPercent: 0,
    taxDefinitionId: "tx18", net: 22.88, vat: 4.12, gross: 27, tracked: true, delivered: 0, invoiced: 0, invoicedDraft: 0, toDeliver: 10, toInvoice: 10,
  }],
};

function renderAt(path: string, children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/sales-orders/:id" element={children} />
            <Route path="*" element={<p>elsewhere</p>} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  access.approve = true;
  api.partnersAll.mockResolvedValue([
    { id: "p1", name: "Market Arbeni", isCustomer: true, isVendor: false },
    { id: "p2", name: "Viva Fresh", isCustomer: true, isVendor: false },
  ]);
  api.taxes.mockResolvedValue([{ id: "tx18", code: "S18", name: "TVSH 18%", rate: 0.18, scope: 0 }]);
  api.itemsGET.mockResolvedValue({ items: [WATER], total: 1, page: 1, pageSize: 200 });
  api.itemsGET2.mockResolvedValue(WATER);
  api.listWarehouses.mockResolvedValue([{ id: "wh1", code: "MAIN", name: "Main", isActive: true, isDefault: true }]);
  api.getCustomerCreditStatus.mockResolvedValue({
    partnerId: "p1", creditLimit: 1000, outstanding: 400, openOrders: 100, available: 500, overdue: 0, oldestOverdueDays: 0, overdueBlockDays: 30, overdueBlocked: false,
  });
  // The customer's list: 2.70 a pack, 2.40 from 60 pieces.
  api.resolvePrices.mockImplementation((_c: string, itemIds: string[], _w: unknown, _d: unknown, partnerId: string | undefined, quantities: number[]) =>
    Promise.resolve(itemIds.map((itemId, i) => {
      const tier = (quantities?.[i] ?? 0) >= 60;
      const pack = partnerId ? (tier ? 2.4 : 2.7) : 3;
      return { itemId, price: pack / 6, source: partnerId ? "customer" : "item", priceListId: undefined, units: [{ unitName: "pako", factor: 6, price: pack }], tierMinQuantity: tier ? 60 : undefined };
    })));
});

describe("Sales order form (P6)", () => {
  it("prices lines from the customer's list by quantity and saves the order as entered", async () => {
    api.createSalesOrder.mockResolvedValue({ ...ORDER, id: "so9" });
    renderAt("/sales-orders/new", <SalesOrderDetail />);

    fireEvent.click(await screen.findByRole("combobox", { name: "Customer" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Market Arbeni/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Ujë 0.5L/ }));

    // One pack of six, priced for this customer, per pack.
    await waitFor(() => expect(api.resolvePrices).toHaveBeenCalledWith("c1", ["i1"], undefined, isoToday(), "p1", [6]));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Price incl. VAT" })).toHaveValue("2.7"));

    fireEvent.change(screen.getByRole("textbox", { name: "Quantity" }), { target: { value: "10" } });
    await waitFor(() => expect(api.resolvePrices).toHaveBeenLastCalledWith("c1", ["i1"], undefined, isoToday(), "p1", [60]));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Price incl. VAT" })).toHaveValue("2.4"));
    expect(screen.getByText(/Customer's price list · from 60/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.createSalesOrder).toHaveBeenCalled());
    expect(api.createSalesOrder.mock.calls[0][1]).toMatchObject({
      partnerId: "p1",
      date: isoToday(),
      lines: [{ itemId: "i1", description: "Ujë 0.5L", quantity: 10, unitName: "pako", unitPrice: 2.4, discountPercent: 0, taxDefinitionId: "tx18" }],
    });
    // No totals are computed in the browser before the server has them.
    expect(screen.queryByTestId("so-total")).not.toBeInTheDocument();
  });

  it("re-prices every line when the customer changes", async () => {
    renderAt("/sales-orders/new", <SalesOrderDetail />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Item" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Ujë 0.5L/ }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Price incl. VAT" })).toHaveValue("3"));

    fireEvent.click(screen.getByRole("combobox", { name: "Customer" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Viva Fresh/ }));
    await waitFor(() => expect(api.resolvePrices).toHaveBeenLastCalledWith("c1", ["i1"], undefined, isoToday(), "p2", [6]));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Price incl. VAT" })).toHaveValue("2.7"));
  });

  it("offers an approver the override when confirming is refused, and resends with the reason", async () => {
    api.getSalesOrder.mockResolvedValue(ORDER);
    api.confirmSalesOrder
      .mockRejectedValueOnce(new ApiException("Bad Request", 400, JSON.stringify("Market Arbeni is over the credit limit 1000.00."), {}, null))
      .mockResolvedValueOnce({ ...ORDER, state: 2, number: "SO-00001", blockOverrideReason: "Pays on Friday" });
    renderAt("/sales-orders/so1", <SalesOrderDetail />);

    expect(await screen.findByTestId("so-total")).toHaveTextContent("27.00");
    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Market Arbeni is over the credit limit 1000.00.")).toBeInTheDocument();
    expect(api.confirmSalesOrder).toHaveBeenNthCalledWith(1, "c1", "so1", { overrideReason: undefined });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Pays on Friday" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm with reason" }));

    await waitFor(() => expect(api.confirmSalesOrder).toHaveBeenNthCalledWith(2, "c1", "so1", { overrideReason: "Pays on Friday" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/Confirmed over the credit block: Pays on Friday/)).toBeInTheDocument();
    // Saving first is skipped: nothing changed since the order was loaded.
    expect(api.updateSalesOrder).not.toHaveBeenCalled();
  });

  it("shows the refusal to someone without Approve, with no override", async () => {
    access.approve = false;
    api.getSalesOrder.mockResolvedValue(ORDER);
    api.confirmSalesOrder.mockRejectedValue(new ApiException("Bad Request", 400, JSON.stringify("Invoices are overdue."), {}, null));
    renderAt("/sales-orders/so1", <SalesOrderDetail />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm order" }));
    expect(await screen.findByText("Invoices are overdue.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
