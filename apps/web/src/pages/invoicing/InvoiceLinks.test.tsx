import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { InvoiceResponse } from "@pako/shared";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";
import { Invoicing } from "@/pages/invoicing/Invoicing";

// docs/POS_PLAN.md P6 — invoices made from a sales order or a delivery note keep each line's link
// to its order line and delivery line, on create and on every later save.
const api = vi.hoisted(() => ({
  partnersAll: vi.fn(),
  invoicesAll: vi.fn(),
  taxes: vi.fn(),
  paymentMethodsAll: vi.fn(),
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
  accountsAll: vi.fn(),
  preview: vi.fn(),
  creditExposure: vi.fn(),
  listWarehouses: vi.fn(),
  getStockOnHand: vi.fn(),
  getSalesOrderInvoiceDraft: vi.fn(),
  getStockDocument: vi.fn(),
  resolvePrices: vi.fn(),
  invoicesPOST: vi.fn(),
  invoicesPUT: vi.fn(),
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

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1", activeCompany: { id: "c1", name: "Pako Distribution", isVatRegistered: false } }),
}));

const CUSTOMER = { id: "p1", name: "Market Arbeni", isCustomer: true, isVendor: false, isVatRegistered: false, taxNumber: undefined };
const WATER = {
  id: "i1", code: 101, name: "Ujë 0.5L", unit: "copë", salesUnit: "pako", salesUnitFactor: 6, defaultTaxDefinitionId: undefined,
  defaultRevenueAccountId: undefined, defaultUnitPrice: 0.5, barcodes: [], trackInventory: true,
};

function renderAt(path: string, children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.partnersAll.mockResolvedValue([CUSTOMER]);
  api.invoicesAll.mockResolvedValue([]);
  api.taxes.mockResolvedValue([]);
  api.paymentMethodsAll.mockResolvedValue([]);
  api.itemsGET.mockResolvedValue({ items: [WATER], total: 1, page: 1, pageSize: 200 });
  api.itemsGET2.mockResolvedValue(WATER);
  api.accountsAll.mockResolvedValue([]);
  api.preview.mockResolvedValue({ number: "INV-00007" });
  api.creditExposure.mockRejectedValue(new Error("none"));
  api.listWarehouses.mockResolvedValue([{ id: "wh1", code: "MAIN", name: "Main", isActive: true, isDefault: true }]);
  api.getStockOnHand.mockResolvedValue([]);
  api.invoicesPOST.mockResolvedValue({ id: "inv1" });
  api.invoicesPUT.mockResolvedValue({ id: "inv1" });
});

describe("Invoice from a sales order (P6)", () => {
  it("fills the form from ?salesOrder= and sends each line's order and delivery links on create", async () => {
    api.getSalesOrderInvoiceDraft.mockResolvedValue({
      partnerId: "p1", warehouseId: "wh1", orderNumber: "SO-00001",
      lines: [
        { itemId: "i1", description: "Ujë 0.5L", quantity: 4, unitName: "pako", unitPrice: 2.7, discountPercent: 5, taxDefinitionId: undefined,
          salesOrderLineId: "sol1", deliveryLineId: "dl1", deliveryNumber: "FD-00003" },
        { itemId: "i1", description: "Ujë 0.5L", quantity: 2, unitName: "pako", unitPrice: 2.7, discountPercent: 5, taxDefinitionId: undefined,
          salesOrderLineId: "sol1", deliveryLineId: undefined, deliveryNumber: undefined },
      ],
    });
    renderAt("/invoicing?salesOrder=so1&undelivered=1", <Invoicing />);

    const dialog = await screen.findByRole("dialog");
    expect(api.getSalesOrderInvoiceDraft).toHaveBeenCalledWith("c1", "so1", true);
    expect(await within(dialog).findByText("SO-00001 · FD-00003")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create invoice" }));

    await waitFor(() => expect(api.invoicesPOST).toHaveBeenCalled());
    const body = api.invoicesPOST.mock.calls[0][1];
    expect(body).toMatchObject({ partnerId: "p1", warehouseId: "wh1" });
    expect(body.lines).toEqual([
      expect.objectContaining({ itemId: "i1", quantity: 4, unitName: "pako", unitPrice: 2.7, discountPercent: 5, salesOrderLineId: "sol1", deliveryLineId: "dl1" }),
      expect.objectContaining({ itemId: "i1", quantity: 2, salesOrderLineId: "sol1", deliveryLineId: undefined }),
    ]);
  });

  it("fills the form from a posted delivery note's unbilled quantities at the customer's price", async () => {
    api.getStockDocument.mockResolvedValue({
      id: "dn1", type: 6, state: 1, number: "FD-00003", date: "2026-11-01", warehouseId: "wh1", warehouseName: "Main", partnerId: "p1", partnerName: "Market Arbeni",
      destinationWarehouseId: undefined, destinationWarehouseName: undefined, reason: undefined, atkNoticeDate: undefined, notes: undefined, totalValue: 10,
      vatRepaymentDue: false, journalEntryId: undefined, postedAt: undefined,
      lines: [
        { id: "dl1", itemId: "i1", itemCode: 101, itemName: "Ujë 0.5L", unit: "copë", quantity: 24, billed: 6, salesOrderLineId: "sol1",
          unitCost: undefined, bookQuantity: undefined, difference: undefined, value: undefined, note: undefined },
        { id: "dl2", itemId: "i1", itemCode: 101, itemName: "Ujë 0.5L", unit: "copë", quantity: 6, billed: 6, salesOrderLineId: "sol1",
          unitCost: undefined, bookQuantity: undefined, difference: undefined, value: undefined, note: undefined },
      ],
    });
    api.resolvePrices.mockResolvedValue([{ itemId: "i1", price: 0.45, source: "customer", priceListId: "pl1" }]);
    renderAt("/invoicing?delivery=dn1", <Invoicing />);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(api.resolvePrices).toHaveBeenCalledWith("c1", ["i1"], "wh1", expect.any(String), "p1", [18]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(api.invoicesPOST).toHaveBeenCalled());
    expect(api.invoicesPOST.mock.calls[0][1].lines).toEqual([
      expect.objectContaining({ itemId: "i1", quantity: 18, unitPrice: 0.45, deliveryLineId: "dl1", salesOrderLineId: "sol1" }),
    ]);
  });
});

describe("Editing a draft invoice (P6)", () => {
  it("keeps the order and delivery links of a line whose quantity changed", async () => {
    const draft: InvoiceResponse = {
      id: "inv1", partnerId: "p1", invoiceNumber: undefined, issueDate: "2026-11-01", dueDate: "2026-11-01", state: "Draft", documentType: 0,
      originalInvoiceId: undefined, journalEntryId: undefined, internalNotes: undefined, priceMode: 0, paymentTermDays: undefined, graceDays: undefined,
      lines: [{
        id: "l1", description: "Ujë 0.5L", quantity: 4, unitPrice: 2.7, taxDefinitionId: undefined, revenueAccountId: "r1", discountPercent: 0,
        itemId: "i1", unitName: "pako", salesOrderLineId: "sol1", deliveryLineId: "dl1",
      }],
    };
    const onSaved = vi.fn();
    renderAt("/invoicing/inv1", (
      <InvoiceForm companyId="c1" customers={[CUSTOMER as never]} taxes={[]} invoices={[]} paymentMethods={[]} isVatRegistered={false}
        items={[WATER as never]} onCreated={() => {}} editingInvoice={draft} onSaved={onSaved} />
    ));
    expect(screen.getByTestId("invoice-line-link-0")).toHaveTextContent("From the delivery note");
    fireEvent.change(screen.getByDisplayValue("4"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.invoicesPUT).toHaveBeenCalled());
    expect(api.invoicesPUT.mock.calls[0][2].lines).toEqual([
      expect.objectContaining({ itemId: "i1", quantity: 3, salesOrderLineId: "sol1", deliveryLineId: "dl1" }),
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
