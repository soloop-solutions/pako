import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { ItemAttributesDialog } from "@/pages/items/ItemVariants";
import { PosReports } from "@/pages/pos/PosReports";
import { Till } from "@/pages/pos/Till";

// docs/POS_PLAN.md P2 retail: variants, serials, customer orders, the sales report and attributes,
// against a mocked generated client (same pattern as Pos.test.tsx).
const api = vi.hoisted(() => ({
  getPosBootstrap: vi.fn(),
  getPosCatalog: vi.fn(),
  quotePosBasket: vi.fn(),
  submitPosOrder: vi.fn(),
  scanPosCode: vi.fn(),
  listCustomerOrders: vi.fn(),
  getPosSalesReport: vi.fn(),
  listPosStores: vi.fn(),
  listPosRegisters: vi.fn(),
  listItemAttributes: vi.fn(),
  createItemAttribute: vi.fn(),
  updateItemAttribute: vi.fn(),
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

vi.mock("qrcode", () => ({ default: { toDataURL: () => Promise.resolve("data:image/png;base64,") } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1" }) }));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const STORE = {
  id: "s1", code: "PR1", name: "Prishtina 1", address: undefined, fiscalBranchNumber: 1, location: "Prishtinë",
  warehouseId: "w1", priceListId: undefined, receiptHeader: undefined, receiptFooter: undefined, isActive: true,
};
const REGISTER = {
  id: "r1", storeId: "s1", storeName: "Prishtina 1", code: "K1", name: "Arka 1", profile: 0, fiscalMode: 0, fiscalPosNumber: 1,
  fiscalizationNumber: undefined, cashAccountId: "a1", isActive: true, certificateNotAfter: undefined, openSessionId: "ss1",
};
const SESSION = { id: "ss1", registerId: "r1", registerCode: "K1", number: 1, state: 0, businessDate: "2026-10-31", openedAt: "2026-10-31T08:00:00Z", closedAt: undefined, netSales: 0, journalEntryId: undefined };
const BOOT = {
  register: REGISTER, store: STORE, session: SESSION, cashLimitB2C: 2000, companyName: "Shop Co", fiscalNumber: "811234567", vatNumber: undefined,
  tenders: [{ id: "cash", name: "Arka", kind: 0 }, { id: "gift", name: "Kartelë dhuratë", kind: 4 }],
};
const base = {
  unit: "copë", salesUnit: undefined, salesUnitFactor: undefined, taxDefinitionId: "t18", taxLetter: "E", taxRate: 0.18,
  tracksStock: true, trackLots: false, categoryId: undefined,
};
const MILK = { ...base, id: "i1", code: 7, name: "Qumësht 1L", barcodes: ["3830001"], price: 0.9 };
const PHONE = { ...base, id: "p1", code: 9, name: "Telefon X", barcodes: ["111"], price: 300, trackSerials: true };
const SHIRT_M = { ...base, id: "v1", code: 21, name: "Bluzë M", barcodes: ["200"], price: 10, variantOfItemId: "tpl", variantLabel: "M" };
const SHIRT_L = { ...base, id: "v2", code: 22, name: "Bluzë L", barcodes: ["201"], price: 12, variantOfItemId: "tpl", variantLabel: "L" };

type Body = {
  lines: { itemId?: string; quantity: number; unitPrice: number; serialNumber?: string }[];
  payments?: { paymentMethodId: string; amount: number; tendered?: number; reference?: string }[];
};
const round = (v: number) => Math.round(v * 100) / 100;
// The mock server's pricing (a test fixture, not the browser's).
function quote(_c: string, _r: string, body: Body) {
  const total = round(body.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const paid = round((body.payments ?? []).reduce((s, p) => s + (p.tendered ?? p.amount), 0));
  return Promise.resolve({
    lines: body.lines.map((l) => ({ taxLetter: "E", gross: round(l.quantity * l.unitPrice), net: 0, tax: 0 })), taxes: [], total, totalTax: 0, totalDiscount: 0,
    paid, remaining: Math.max(0, round(total - paid)), change: Math.max(0, round(paid - total)), cashLimitExceeded: false,
  });
}
const lastQuote = () => api.quotePosBasket.mock.lastCall?.[2] as Body;
const recorded = (body: { clientUuid: string }) => ({
  id: "o1", clientUuid: body.clientUuid, number: "K1-000001", kind: 0, state: 0, orderedAt: "2026-10-31T09:00:00Z", operatorName: "Arta",
  customerId: undefined, originalOrderId: undefined, total: 1.8, totalTax: 0, totalDiscount: 0, change: 0, registerId: "r1",
  lines: [], payments: [], taxes: [], fiscal: undefined,
});

function renderTill() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/pos/till/r1"]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/pos/till/:registerId" element={<Till />} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

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

describe("Till — variants, serials and customer orders (P2)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.getPosBootstrap.mockResolvedValue(BOOT);
    api.getPosCatalog.mockResolvedValue([MILK, PHONE, SHIRT_M, SHIRT_L]);
    api.quotePosBasket.mockImplementation(quote);
  });

  it("asks for the serial number of a serial-tracked item and sends it on a line of one", async () => {
    renderTill();
    const search = await screen.findByLabelText("Scan a barcode or search…");
    fireEvent.change(search, { target: { value: "111" } });
    fireEvent.keyDown(search, { key: "Enter" });
    const dialog = await screen.findByRole("dialog");
    // Required: an empty serial is refused.
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText("Scan or type the unit's serial number.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Serial number / IMEI"), { target: { value: "IMEI-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "p1", quantity: 1, unitPrice: 300, serialNumber: "IMEI-1" });
    expect(screen.getByTestId("line-serial")).toHaveTextContent("IMEI-1");
    // Its quantity can't be changed.
    expect(screen.queryByLabelText("Qty")).not.toBeInTheDocument();
  });

  it("shows one tile per template and adds the variant picked from it", async () => {
    renderTill();
    const tile = await screen.findByTestId("variant-tile");
    expect(tile).toHaveTextContent("Bluzë");
    expect(tile).toHaveTextContent("2 variants");
    // The variants themselves have no tiles of their own.
    expect(screen.queryByText("Bluzë M")).not.toBeInTheDocument();
    fireEvent.click(tile);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("12.00")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("L"));

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "v2", quantity: 1, unitPrice: 12 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("collects a customer order: its lines at the agreed price, the order id and its deposit as a gift-card tender", async () => {
    api.listCustomerOrders.mockResolvedValue({
      items: [{
        id: "co1", number: "CO-000001", kind: 0, state: 1, customerId: "pt1", customerName: "Blerta", storeId: "s1", dueDate: undefined, notes: undefined,
        lines: [{ id: "col1", itemId: "i1", description: "Qumësht 1L", quantity: 2, unitPrice: 0.9, amount: 1.8 }],
        total: 1.8, depositCardNumber: "DEP-1", deposited: 1, remaining: 0.8, createdAt: "2026-10-20T09:00:00Z", collectedOrderId: undefined,
      }],
      total: 1, page: 1, pageSize: 25,
    });
    api.submitPosOrder.mockImplementation((_c: string, body: { clientUuid: string }) => Promise.resolve(recorded(body)));
    renderTill();
    fireEvent.click(await screen.findByRole("button", { name: "Customer orders" }));
    const list = await screen.findByRole("dialog");
    fireEvent.click(await within(list).findByRole("button", { name: "Collect" }));

    await waitFor(() => expect(screen.getByTestId("till-total")).toHaveTextContent("1.80"));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "i1", quantity: 2, unitPrice: 0.9 });
    expect(screen.getByTestId("collecting-order")).toHaveTextContent("CO-000001");

    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    const pay = await screen.findByRole("dialog");
    const offer = within(pay).getByTestId("offered-tender");
    expect(offer).toHaveTextContent("Card DEP-1: 1.00");
    const use = within(offer).getByRole("button", { name: "Use" });
    await waitFor(() => expect(use).toBeEnabled());
    fireEvent.click(use);
    const exact = within(pay).getByRole("button", { name: "Exact amount" });
    await waitFor(() => expect(within(pay).queryByTestId("offered-tender")).not.toBeInTheDocument());
    await waitFor(() => expect(exact).toBeEnabled());
    fireEvent.click(exact);
    const confirm = within(pay).getByRole("button", { name: "Complete sale" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    const body = api.submitPosOrder.mock.calls[0][1];
    expect(body.customerOrderId).toBe("co1");
    expect(body.payments[0]).toMatchObject({ paymentMethodId: "gift", amount: 1, reference: "DEP-1" });
    expect(body.payments[1]).toMatchObject({ paymentMethodId: "cash", amount: 0.8 });

    // A recorded collect leaves no order behind for the next sale.
    fireEvent.click(await screen.findByRole("button", { name: "New sale" }));
    await waitFor(() => expect(screen.queryByTestId("collecting-order")).not.toBeInTheDocument());
  });
});

describe("Sales report (P2)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listPosStores.mockResolvedValue([STORE]);
    api.listPosRegisters.mockResolvedValue([REGISTER]);
    const row = { key: "i1", label: "Qumësht 1L", orders: 3, quantity: 5, sales: 4.5, returns: 0, netSales: 4.5, tax: 0.69, discount: 0, cost: 3, margin: 0.81 };
    api.getPosSalesReport.mockImplementation((_c: string, from: string, to: string, groupBy: number) =>
      Promise.resolve({
        from, to, groupBy,
        rows: groupBy === 5 ? [row] : [{ ...row, key: "2026-10-31", label: "31.10.2026", cost: undefined, margin: undefined }],
        total: { ...row, key: "", label: "", cost: groupBy === 5 ? 3 : undefined, margin: groupBy === 5 ? 0.81 : undefined },
      }),
    );
  });

  it("asks the server for the chosen grouping and shows cost and margin only when it gives them", async () => {
    renderWith(<PosReports />);
    await waitFor(() => expect(api.getPosSalesReport).toHaveBeenCalled());
    expect(api.getPosSalesReport.mock.calls[0][3]).toBe(0);
    expect(await screen.findByText("31.10.2026")).toBeInTheDocument();
    expect(screen.queryByText("Margin")).not.toBeInTheDocument();

    // The first "Group by" is the report's; the grid has its own grouping control.
    fireEvent.click(screen.getAllByRole("combobox", { name: "Group by" })[0]);
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Item" }));
    await waitFor(() => expect(api.getPosSalesReport.mock.lastCall?.[3]).toBe(5));
    expect(api.getPosSalesReport.mock.lastCall?.[4]).toBeUndefined();
    expect(await screen.findByText("Margin")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });
});

describe("Item attributes (P2 variants)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listItemAttributes.mockResolvedValue([]);
    api.createItemAttribute.mockResolvedValue({ id: "a1", name: "Madhësia", sortOrder: 0, values: [] });
  });

  it("creates an attribute with its values in the order listed", async () => {
    renderWith(<ItemAttributesDialog onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "New attribute" }));
    // The attribute's own dialog opens over the list.
    const dialog = await screen.findByRole("dialog", { name: "New attribute" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Madhësia" } });
    fireEvent.change(within(dialog).getByLabelText("Value"), { target: { value: "S" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add value" }));
    fireEvent.change(within(dialog).getAllByLabelText("Value")[1], { target: { value: "M" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.createItemAttribute).toHaveBeenCalledWith("c1", {
        name: "Madhësia", sortOrder: 0, values: [{ id: undefined, value: "S", sortOrder: 0 }, { id: undefined, value: "M", sortOrder: 1 }],
      }),
    );
  });
});
