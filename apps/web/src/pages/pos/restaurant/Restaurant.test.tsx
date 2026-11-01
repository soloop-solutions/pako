import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { setPosOperator } from "@/lib/pos-operator";
import { Till } from "@/pages/pos/Till";

// docs/POS_PLAN.md P3 — the restaurant till (floor plan, tabs, paying a tab, waiter PIN) against a
// mocked generated client and a mocked SignalR hub.
const api = vi.hoisted(() => ({
  getPosBootstrap: vi.fn(),
  getPosCatalog: vi.fn(),
  getPosFloorPlan: vi.fn(),
  getPosMenu: vi.fn(),
  listItemCategories: vi.fn(),
  openPosTab: vi.fn(),
  getPosTab: vi.fn(),
  addPosTabLines: vi.fn(),
  sendPosTab: vi.fn(),
  quotePosBasket: vi.fn(),
  submitPosOrder: vi.fn(),
  posPinSignIn: vi.fn(),
  listOpenPosTabs: vi.fn(),
  getPosHotelCalendar: vi.fn(),
  chargePosTabToRoom: vi.fn(),
  preBillPosTab: vi.fn(),
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

const hub = vi.hoisted(() => ({ invoke: vi.fn(() => Promise.resolve()), handlers: {} as Record<string, () => void> }));
vi.mock("@microsoft/signalr", () => {
  class HubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() {
      return {
        on: (name: string, fn: () => void) => { hub.handlers[name] = fn; },
        onreconnected: () => undefined,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        invoke: hub.invoke,
      };
    }
  }
  return { HubConnectionBuilder, LogLevel: { Warning: 3 } };
});

vi.mock("qrcode", () => ({ default: { toDataURL: () => Promise.resolve("data:image/png;base64,") } }));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1" }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const STORE = {
  id: "s1", code: "PR1", name: "Restorant Prishtina", address: "Rr. Agim Ramadani", fiscalBranchNumber: 1, location: "Prishtinë",
  warehouseId: "w1", priceListId: undefined, receiptHeader: undefined, receiptFooter: undefined, isActive: true,
};
const REGISTER = {
  id: "r1", storeId: "s1", storeName: "Restorant Prishtina", code: "K1", name: "Arka 1", profile: 3, fiscalMode: 0, fiscalPosNumber: 1,
  fiscalizationNumber: undefined, cashAccountId: "a1", isActive: true, certificateNotAfter: undefined, openSessionId: "ss1",
};
const SESSION = { id: "ss1", registerId: "r1", registerCode: "K1", number: 1, state: 0, businessDate: "2026-11-01", openedAt: "2026-11-01T08:00:00Z", closedAt: undefined, netSales: 0, journalEntryId: undefined };
const BOOT = {
  register: REGISTER, store: STORE, session: SESSION, cashLimitB2C: 2000, companyName: "Resto Co", fiscalNumber: "811234567", vatNumber: undefined,
  tenders: [{ id: "cash", name: "Arka", kind: 0 }, { id: "card", name: "Kartelë", kind: 2 }],
};
const item = (id: string, name: string, price: number) => ({
  id, code: Number(id.replace(/\D/g, "")) || 1, name, unit: "copë", salesUnit: undefined, salesUnitFactor: undefined, barcodes: [], price,
  taxDefinitionId: "t18", taxLetter: "C", taxRate: 0.18, tracksStock: false, trackLots: false, categoryId: undefined,
});
const BURGER = item("i1", "Burger", 5);
const COLA = item("i2", "Cola", 1.5);

const SUMMARY = {
  id: "tab1", number: "T-0001", name: undefined, kind: 0, state: 0, tableId: "t2", tableName: "T2", covers: 2, waiterName: "Arta",
  openedAt: "2026-11-01T12:00:00Z", total: 10, due: 10, pendingLines: 0, requestedLines: 0,
};
const PLAN = {
  floors: [{
    id: "f1", name: "Salla", tables: [
      { id: "t1", name: "T1", seats: 4, shape: 0, x: 0, y: 0, width: 2, height: 2, tabs: [] },
      { id: "t2", name: "T2", seats: 4, shape: 1, x: 3, y: 0, width: 2, height: 2, tabs: [SUMMARY] },
    ],
  }],
  otherTabs: [],
};
const line = (over: Record<string, unknown>) => ({
  id: "l1", lineNo: 1, itemId: "i1", description: "Burger", quantity: 2, unitPrice: 5, discountAmount: 0, gross: 10, state: 1, seat: undefined,
  course: 1, note: undefined, modifiers: undefined, parentLineId: undefined, productionCenterId: undefined, sentAt: "2026-11-01T12:05:00Z",
  paidQuantity: 0, remaining: 2, remainingGross: 10, voidReason: undefined, ...over,
});
const tab = (over: Record<string, unknown> = {}) => ({
  id: "tab1", number: "T-0001", name: undefined, kind: 0, state: 0, storeId: "s1", tableId: "t2", tableName: "T2", covers: 2, waiterName: "Arta",
  openedAt: "2026-11-01T12:00:00Z", deliveryAddress: undefined, deliveryPhone: undefined, driverName: undefined, preBillCount: 0,
  lines: [line({})], taxes: [{ taxLetter: "C", taxRate: 0.18, gross: 10, net: 8.47, tax: 1.53 }], total: 10, paid: 0, due: 10, ...over,
});
const MENU = {
  modifierGroups: [{
    id: "g1", name: "Pjekja", minSelect: 1, maxSelect: 1, isActive: true, itemIds: ["i1"],
    modifiers: [
      { id: "m1", name: "Rare", priceDelta: 0, ingredientItemId: undefined, ingredientQuantity: undefined, sortOrder: 1, isActive: true },
      { id: "m2", name: "Well done", priceDelta: 0, ingredientItemId: undefined, ingredientQuantity: undefined, sortOrder: 2, isActive: true },
    ],
  }],
  combos: {}, productionCenters: {}, centers: [],
};

function renderTill(url = "/pos/till/r1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/pos/till/:registerId" element={<Till />} />
            <Route path="/pos" element={<p>home</p>} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Till — restaurant (P3)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    hub.invoke.mockClear();
    setPosOperator(null);
    api.getPosBootstrap.mockResolvedValue(BOOT);
    api.getPosCatalog.mockResolvedValue([BURGER, COLA]);
    api.getPosFloorPlan.mockResolvedValue(PLAN);
    api.getPosMenu.mockResolvedValue(MENU);
    api.listItemCategories.mockResolvedValue([]);
    api.listOpenPosTabs.mockResolvedValue([SUMMARY]);
  });
  afterEach(() => {
    setPosOperator(null);
    vi.unstubAllGlobals();
  });

  it("opens on the floor plan, joins the store's live channel, and opens a free table with its covers", async () => {
    api.openPosTab.mockResolvedValue(tab({ id: "tab9", number: "T-0009", tableId: "t1", tableName: "T1", lines: [], total: 0, due: 0, taxes: [] }));
    api.getPosTab.mockResolvedValue(tab({ id: "tab9", number: "T-0009", tableId: "t1", tableName: "T1", lines: [], total: 0, due: 0, taxes: [] }));
    renderTill();
    const tables = await screen.findAllByTestId("floor-table");
    expect(tables).toHaveLength(2);
    expect(tables[0]).toHaveAttribute("data-status", "free");
    expect(tables[1]).toHaveAttribute("data-status", "open");
    expect(within(tables[1]).getByText("10.00")).toBeInTheDocument();
    await waitFor(() => expect(hub.invoke).toHaveBeenCalledWith("JoinStore", "c1", "s1"));

    fireEvent.click(tables[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "3" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Open tab" }));
    await waitFor(() => expect(api.openPosTab).toHaveBeenCalledWith("c1", { storeId: "s1", kind: 0, covers: 3, tableId: "t1" }));
    // The new tab opens: its number and an empty order.
    expect(await screen.findByTestId("tab-title")).toHaveTextContent("T-0009 · T1");
    expect(screen.getByText("Nothing ordered yet. Tap an item on the menu.")).toBeInTheDocument();
  });

  it("asks for a required modifier before adding the item and sends the chosen modifierIds", async () => {
    api.getPosTab.mockResolvedValue(tab({ lines: [], total: 0, due: 0, taxes: [] }));
    api.addPosTabLines.mockResolvedValue(tab({ lines: [line({ state: 0, quantity: 1, gross: 5, remaining: 1, remainingGross: 5, modifiers: "Rare" })], total: 5, due: 5 }));
    renderTill("/pos/till/r1?tab=tab1");
    fireEvent.click(await within(await screen.findByTestId("menu-tiles")).findByText("Burger"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Choose 1")).toBeInTheDocument();
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    expect(api.addPosTabLines).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /Rare/ }));
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(api.addPosTabLines).toHaveBeenCalledWith("c1", "tab1", { lines: [{ itemId: "i1", quantity: 1, course: 1, modifierIds: ["m1"] }] }));
    expect(await screen.findByTestId("line-modifiers")).toHaveTextContent("Rare");
  });

  it("sends the pending lines to the kitchen", async () => {
    api.getPosTab.mockResolvedValue(tab({ lines: [line({ state: 0 })] }));
    api.sendPosTab.mockResolvedValue(tab());
    renderTill("/pos/till/r1?tab=tab1");
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Send to kitchen/ }));
    await waitFor(() => expect(api.sendPosTab).toHaveBeenCalledWith("c1", "tab1", undefined));
    expect(await screen.findByText("Sent")).toBeInTheDocument();
  });

  it("pays a whole tab: the order carries the tab and its lines by tabLineId, with the tip on the tender", async () => {
    api.getPosTab.mockResolvedValue(tab());
    api.quotePosBasket.mockImplementation((_c: string, _r: string, body: { payments?: { amount: number; tendered?: number; tip?: number }[] }) => {
      const paid = (body.payments ?? []).reduce((s, p) => s + (p.tendered ?? p.amount + (p.tip ?? 0)) - (p.tip ?? 0), 0);
      return Promise.resolve({
        lines: [{ taxLetter: "C", gross: 10, net: 8.47, tax: 1.53 }], taxes: [], total: 10, totalTax: 1.53, totalDiscount: 0,
        paid, remaining: Math.max(0, 10 - paid), change: Math.max(0, paid - 10), cashLimitExceeded: false,
      });
    });
    api.submitPosOrder.mockImplementation((_c: string, body: { clientUuid: string }) => Promise.resolve({
      id: "o1", clientUuid: body.clientUuid, number: "K1-00001", kind: 0, state: 0, orderedAt: "2026-11-01T13:00:00Z", operatorName: "Arta",
      customerId: undefined, originalOrderId: undefined, total: 10, totalTax: 1.53, totalDiscount: 0, change: 8, registerId: "r1",
      lines: [{ id: "ol1", lineNo: 1, itemId: "i1", description: "Burger", unit: "copë", quantity: 2, unitPrice: 5, discountAmount: 0, taxLetter: "C", gross: 10, net: 8.47, tax: 1.53, returnable: 2 }],
      payments: [{ paymentMethodId: "cash", name: "Arka", amount: 10, tendered: 20, tip: 2 }],
      taxes: [{ taxLetter: "C", taxRate: 0.18, gross: 10, net: 8.47, tax: 1.53 }],
      fiscal: { type: 9, couponId: 1, dailyNumber: 1, referenceCouponId: undefined, verificationNo: "ABC", issuedAt: "2026-11-01T13:00:00Z", qrCode: "x", atkStatus: 0, atkTransactionNo: undefined, atkError: undefined, sendBy: undefined },
    }));
    renderTill("/pos/till/r1?tab=tab1");
    fireEvent.click(await screen.findByRole("button", { name: /^Pay$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Pay all/ }));

    const dialog = await screen.findByRole("dialog", { name: "Payment" });
    await waitFor(() => expect(api.quotePosBasket).toHaveBeenCalled());
    // The quote prices the tab's lines, by tab line.
    expect(api.quotePosBasket.mock.calls[0][2]).toMatchObject({ tabId: "tab1", lines: [{ tabLineId: "l1", quantity: 2, unitPrice: 0, description: "" }] });
    fireEvent.change(within(dialog).getByLabelText("Tip"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Cash given"), { target: { value: "20" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Add" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByTestId("tender-tip")).toHaveTextContent("+ tip 2.00");
    const confirm = within(dialog).getByRole("button", { name: "Complete sale" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    const body = api.submitPosOrder.mock.calls[0][1];
    expect(body.tabId).toBe("tab1");
    expect(body.lines).toEqual([{ description: "", quantity: 2, unitPrice: 0, discountAmount: 0, tabLineId: "l1", itemId: undefined, taxDefinitionId: undefined }]);
    expect(body.payments).toEqual([{ paymentMethodId: "cash", amount: 10, tendered: 20, tip: 2 }]);
    expect(await screen.findByText("Change: 8.00")).toBeInTheDocument();
  });

  it("charges a tab to a checked-in room (P5) and goes back to the floor plan", async () => {
    api.getPosTab.mockResolvedValue(tab());
    const stay = (over: Record<string, unknown>) => ({
      id: "b1", number: "HB-00001", storeId: "s1", roomTypeId: "rt1", roomTypeName: "Double", roomId: "rm1", roomNumber: "101",
      arrival: "2026-10-30", departure: "2026-11-03", nights: 4, adults: 2, children: 0, state: 1, guestName: "Arta Krasniqi",
      nightlyRate: 55, deposited: 0, folioTabId: "f1", guests: [], ...over,
    });
    api.getPosHotelCalendar.mockResolvedValue({
      rooms: [
        { roomId: "rm1", number: "101", roomTypeId: "rt1", roomTypeName: "Double", state: 0, bookings: [stay({})] },
        // Reserved, not in house yet: not offered.
        { roomId: "rm2", number: "102", roomTypeId: "rt1", roomTypeName: "Double", state: 0, bookings: [stay({ id: "b2", roomId: "rm2", roomNumber: "102", state: 0, guestName: "Besa" })] },
      ],
      unassigned: [],
    });
    api.chargePosTabToRoom.mockResolvedValue({ ...tab({ id: "f1", kind: 3 }) });
    renderTill("/pos/till/r1?tab=tab1");

    fireEvent.click(await screen.findByRole("button", { name: /Charge to room/ }));
    const dialog = await screen.findByRole("dialog");
    const rooms = await within(dialog).findAllByTestId("charge-room");
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toHaveTextContent("101");
    expect(rooms[0]).toHaveTextContent("Arta Krasniqi");
    expect(api.getPosHotelCalendar.mock.calls[0][1]).toBe("s1");

    fireEvent.click(rooms[0]);
    await waitFor(() => expect(api.chargePosTabToRoom).toHaveBeenCalledWith("c1", "tab1", "b1"));
    expect(await screen.findAllByTestId("floor-table")).toHaveLength(2);
  });

  it("shows the whole bill's VAT per letter on the pre-bill (billTaxes)", async () => {
    const billTaxes = [{ taxLetter: "C", taxRate: 0.18, gross: 10, net: 8.47, tax: 1.53 }, { taxLetter: "D", taxRate: 0.08, gross: 5, net: 4.63, tax: 0.37 }];
    api.getPosTab.mockResolvedValue(tab());
    api.preBillPosTab.mockResolvedValue(tab({ state: 1, preBillCount: 1, billTaxes }));
    renderTill("/pos/till/r1?tab=tab1");
    fireEvent.click(await screen.findByRole("button", { name: /Pre-bill/ }));
    const taxes = await screen.findByTestId("prebill-taxes");
    expect(taxes).toHaveTextContent("8.47");
    expect(taxes).toHaveTextContent("1.53");
    expect(taxes).toHaveTextContent("4.63");
    expect(taxes).toHaveTextContent("0.37");
  });

  it("signs a waiter in with a PIN, and the till's POS requests then carry the operator header", async () => {
    api.posPinSignIn.mockResolvedValue({ userId: "u7", name: "Blerta", token: "op-token-7", expiresAt: "2099-01-01T00:00:00Z" });
    renderTill();
    fireEvent.click(await screen.findByRole("button", { name: "Waiter" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Waiter sign-in" }));
    await waitFor(() => expect(api.posPinSignIn).toHaveBeenCalledWith("c1", { pin: "1234" }));
    expect(await screen.findByTestId("pos-operator")).toHaveTextContent("Waiter: Blerta");

    // The real client's fetch wrapper adds the header to this company's POS calls only.
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    const { apiClient: realClient } = await vi.importActual<typeof import("@/api/client")>("@/api/client");
    await realClient.submitPosOrder("c1", {
      clientUuid: "u", sessionId: "ss1", kind: 0, orderedAt: "2026-11-01T13:00:00Z", lines: [], payments: [],
    });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(new Headers(calls[0][1].headers).get("X-Pos-Operator")).toBe("op-token-7");
    await realClient.listItemCategories("c1").catch(() => undefined);
    expect(new Headers(calls[1][1].headers).get("X-Pos-Operator")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    expect(await screen.findByRole("button", { name: "Waiter" })).toBeInTheDocument();
  });
});
