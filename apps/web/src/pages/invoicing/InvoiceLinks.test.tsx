import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { InvoiceResponse } from "@pako/shared";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";
import { InvoiceEditorPage } from "@/pages/invoicing/InvoiceEditorPage";

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
  previewGET: vi.fn(),
  creditExposure: vi.fn(),
  listWarehouses: vi.fn(),
  getStockOnHand: vi.fn(),
  getSalesOrderInvoiceDraft: vi.fn(),
  getStockDocument: vi.fn(),
  resolvePrices: vi.fn(),
  invoicesPOST: vi.fn(),
  invoicesPUT: vi.fn(),
  invoicesGET: vi.fn(),
  quoteInvoice: vi.fn(),
  bankAccountsAll: vi.fn(),
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
  api.previewGET.mockResolvedValue({ number: "INV-00007" });
  api.creditExposure.mockRejectedValue(new Error("none"));
  api.listWarehouses.mockResolvedValue([{ id: "wh1", code: "MAIN", name: "Main", isActive: true, isDefault: true }]);
  api.getStockOnHand.mockResolvedValue([]);
  api.invoicesPOST.mockResolvedValue({ id: "inv1" });
  api.invoicesPUT.mockResolvedValue({ id: "inv1" });
  api.bankAccountsAll.mockResolvedValue([]);
  api.resolvePrices.mockResolvedValue([]);
  // The server quote, one line per form line (fixture figures, not computed by the screen).
  api.quoteInvoice.mockImplementation((_c: string, body: { lines: unknown[] }) => Promise.resolve({
    lines: body.lines.map(() => ({ amountBeforeDiscount: 10, discountAmount: 1, netAmount: 9, taxAmount: 1.62, grossAmount: 10.62, unitPriceNet: 4.5, unitPriceGross: 5.31 })),
    totals: { amountBeforeDiscount: 10 * body.lines.length, discountAmount: 1 * body.lines.length, netAmount: 9 * body.lines.length, taxAmount: 1.62 * body.lines.length, grossAmount: 10.62 * body.lines.length },
    taxBreakdown: [],
    totalInWords: "dhjetë euro e 62 cent",
  }));
});

// The editor page as App.tsx routes it, plus a stand-in detail page that shows where Save landed.
function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{location.pathname}</p>;
}
function renderEditor(path: string) {
  return renderAt(path, (
    <Routes>
      <Route path="/invoicing/new" element={<InvoiceEditorPage kind="invoice" />} />
      <Route path="/invoicing/:id/edit" element={<InvoiceEditorPage kind="invoice" />} />
      <Route path="/invoicing/:id" element={<Landed />} />
    </Routes>
  ));
}

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
    renderEditor("/invoicing/new?salesOrder=so1&undelivered=1");

    expect(await screen.findByText("SO-00001 · FD-00003")).toBeInTheDocument();
    expect(api.getSalesOrderInvoiceDraft).toHaveBeenCalledWith("c1", "so1", true);
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));

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
    renderEditor("/invoicing/new?delivery=dn1");

    await waitFor(() => expect(api.resolvePrices).toHaveBeenCalledWith("c1", ["i1"], "wh1", expect.any(String), "p1", [18]));
    fireEvent.click(await screen.findByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(api.invoicesPOST).toHaveBeenCalled());
    expect(api.invoicesPOST.mock.calls[0][1].lines).toEqual([
      expect.objectContaining({ itemId: "i1", quantity: 18, unitPrice: 0.45, deliveryLineId: "dl1", salesOrderLineId: "sol1" }),
    ]);
  });
});

describe("Period discount rules on a new invoice", () => {
  it("fills the line discount from the customer's rule, re-prices on a customer change, and keeps a typed discount", async () => {
    const OTHER = { ...CUSTOMER, id: "p2", name: "Viva Fresh" };
    api.resolvePrices.mockImplementation((_c: string, itemIds: string[], _w: unknown, _d: unknown, partnerId: string | undefined) =>
      Promise.resolve(itemIds.map((itemId) => ({
        itemId, price: partnerId === "p1" ? 0.4 : 0.5, source: partnerId === "p1" ? "item-wholesale" : "item", priceListId: undefined,
        discountPercent: partnerId === "p1" ? 7.5 : undefined, discountRuleId: partnerId === "p1" ? "rule1" : undefined,
      }))));
    renderAt("/invoicing", (
      <InvoiceForm companyId="c1" customers={[CUSTOMER as never, OTHER as never]} taxes={[]} paymentMethods={[]} isVatRegistered={false}
        items={[WATER as never]} onCreated={() => {}} />
    ));

    fireEvent.click(screen.getByRole("combobox", { name: /^Customer/ }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Market Arbeni/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Item" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Ujë 0.5L/ }));

    const discount = () => screen.getByRole("spinbutton", { name: "Discount %" });
    const price = () => screen.getByRole("spinbutton", { name: "Price (incl. VAT)" });
    await waitFor(() => expect(discount()).toHaveValue(7.5));
    expect(price()).toHaveValue(0.4);

    // A customer without a rule or wholesale tier: retail price, no discount.
    fireEvent.click(screen.getByRole("combobox", { name: /^Customer/ }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Viva Fresh/ }));
    await waitFor(() => expect(discount()).toHaveValue(0));
    expect(price()).toHaveValue(0.5);

    // A typed discount survives the next customer change; the price still follows the customer.
    fireEvent.change(discount(), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("combobox", { name: /^Customer/ }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Market Arbeni/ }));
    await waitFor(() => expect(price()).toHaveValue(0.4));
    expect(discount()).toHaveValue(3);
  });
});

describe("Editing a draft invoice (P6)", () => {
  it("keeps the order and delivery links of a line whose quantity changed", async () => {
    const draft: InvoiceResponse = {
      id: "inv1", partnerId: "p1", partnerName: "Customer", invoiceNumber: undefined, issueDate: "2026-11-01", dueDate: "2026-11-01", state: "Draft", documentType: 0,
      originalInvoiceId: undefined, journalEntryId: undefined, internalNotes: undefined, priceMode: 0, paymentTermDays: undefined, graceDays: undefined,
      lines: [{
        id: "l1", description: "Ujë 0.5L", quantity: 4, unitPrice: 2.7, taxDefinitionId: undefined, revenueAccountId: "r1", discountPercent: 0,
        itemId: "i1", unitName: "pako", salesOrderLineId: "sol1", deliveryLineId: "dl1",
      }],
    };
    const onSaved = vi.fn();
    renderAt("/invoicing/inv1", (
      <InvoiceForm companyId="c1" customers={[CUSTOMER as never]} taxes={[]} paymentMethods={[]} isVatRegistered={false}
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

// Client request 2026-11-23: creating an invoice is a full page with the customer's details, a line
// table, and totals quoted by the server.
describe("Invoice editor page", () => {
  const FULL_CUSTOMER = {
    ...CUSTOMER, isVatRegistered: true, vatNumber: "330000001", taxNumber: "810000001", streetAddress: "Rr. Nëna Terezë 1",
    postalCode: "10000", city: "Prishtinë", country: "Kosovo", phone: "044 000 000", email: "blerje@arbeni.test", contactPerson: "Arta", paymentTermDays: 15,
  };

  async function pickCustomerAndItem() {
    fireEvent.click(await screen.findByRole("combobox", { name: /^Customer/ }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Market Arbeni/ }));
    fireEvent.click(screen.getAllByRole("combobox", { name: "Item" })[0]);
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Ujë 0.5L/ }));
  }

  it("shows the picked customer's address, tax numbers, contact and payment terms", async () => {
    api.partnersAll.mockResolvedValue([FULL_CUSTOMER]);
    renderEditor("/invoicing/new");
    fireEvent.click(await screen.findByRole("combobox", { name: /^Customer/ }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Market Arbeni/ }));

    const details = await screen.findByTestId("invoice-customer-details");
    expect(details).toHaveTextContent("Rr. Nëna Terezë 1, 10000 Prishtinë, Kosovo");
    expect(details).toHaveTextContent("810000001");
    expect(details).toHaveTextContent("330000001");
    expect(details).toHaveTextContent("Arta");
    expect(details).toHaveTextContent("044 000 000 · blerje@arbeni.test");
  });

  it("shows the line and document amounts the server quoted, with the price on the other basis", async () => {
    renderEditor("/invoicing/new");
    await pickCustomerAndItem();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Qty" }), { target: { value: "2" } });

    await waitFor(() => expect(api.quoteInvoice).toHaveBeenLastCalledWith("c1", expect.objectContaining({
      priceMode: 0, lines: [expect.objectContaining({ quantity: 2, unitPrice: 0.5, discountPercent: 0 })],
    })));
    await waitFor(() => expect(screen.getByTestId("invoice-grand-total")).toHaveTextContent("10.62 EUR"));
    const line = screen.getByTestId("invoice-line-0");
    expect(within(line).getByText("9.00")).toBeInTheDocument();
    expect(within(line).getByText("1.62")).toBeInTheDocument();
    expect(within(line).getByText("10.62")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-line-other-price-0")).toHaveTextContent("excl. VAT 4.50");
    expect(screen.getByText("dhjetë euro e 62 cent")).toBeInTheDocument();
  });

  it("Enter in the last line's quantity adds a line and moves to its quantity; Enter never submits", async () => {
    renderEditor("/invoicing/new");
    const qty = await screen.findByRole("spinbutton", { name: "Qty" });
    qty.focus();
    fireEvent.keyDown(qty, { key: "Enter" });

    await waitFor(() => expect(screen.getAllByRole("spinbutton", { name: "Qty" })).toHaveLength(2));
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole("spinbutton", { name: "Qty" })[1]));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getAllByRole("spinbutton", { name: "Qty" })[0]);
    expect(api.invoicesPOST).not.toHaveBeenCalled();
  });

  it("Save opens the new invoice; Save and add new stays on a cleared form", async () => {
    renderEditor("/invoicing/new");
    await pickCustomerAndItem();
    fireEvent.click(screen.getByRole("button", { name: "Save and add new" }));
    await waitFor(() => expect(api.invoicesPOST).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole("combobox", { name: "Item" })[0]).toHaveTextContent("No item"));
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();

    await pickCustomerAndItem();
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(await screen.findByTestId("landed")).toHaveTextContent("/invoicing/inv1");
  });
});
