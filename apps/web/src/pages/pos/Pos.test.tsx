import { ApiException } from "@pako/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PosPrograms } from "@/pages/pos/PosPrograms";
import { PosSetup } from "@/pages/pos/PosSetup";
import { Till } from "@/pages/pos/Till";

// docs/POS_PLAN.md P1 — the till and its setup against a mocked generated client.
const api = vi.hoisted(() => ({
  getPosBootstrap: vi.fn(),
  getPosCatalog: vi.fn(),
  quotePosBasket: vi.fn(),
  submitPosOrder: vi.fn(),
  openPosSession: vi.fn(),
  listPosStores: vi.fn(),
  listPosRegisters: vi.fn(),
  scanPosCode: vi.fn(),
  listPosBarcodeRules: vi.fn(),
  createPosBarcodeRule: vi.fn(),
  listPosPrograms: vi.fn(),
  createPosProgram: vi.fn(),
  listItemCategories: vi.fn(),
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
  getGiftCard: vi.fn(),
  createLoyaltyCard: vi.fn(),
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

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1" }),
}));

const access = vi.hoisted(() => ({ canWrite: (module: string): boolean => module !== "" }));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: (m: string) => access.canWrite(m), canApprove: () => true }),
}));

const STORE = {
  id: "s1", code: "PR1", name: "Prishtina 1", address: "Rr. Agim Ramadani", fiscalBranchNumber: 1, location: "Prishtinë",
  warehouseId: "w1", priceListId: undefined, receiptHeader: undefined, receiptFooter: "Faleminderit!", isActive: true,
};
const REGISTER = {
  id: "r1", storeId: "s1", storeName: "Prishtina 1", code: "K1", name: "Arka 1", profile: 0, fiscalMode: 0, fiscalPosNumber: 1,
  fiscalizationNumber: undefined, cashAccountId: "a1", isActive: true, certificateNotAfter: undefined, openSessionId: "ss1",
};
const SESSION = { id: "ss1", registerId: "r1", registerCode: "K1", number: 1, state: 0, businessDate: "2026-10-31", openedAt: "2026-10-31T08:00:00Z", closedAt: undefined, netSales: 0, journalEntryId: undefined };
const BOOT = {
  register: REGISTER, store: STORE, session: SESSION, cashLimitB2C: 2000, companyName: "Market Co", fiscalNumber: "811234567", vatNumber: undefined,
  tenders: [{ id: "cash", name: "Arka", kind: 0 }, { id: "card", name: "Kartelë — POS", kind: 2 }, { id: "acct", name: "Me afat", kind: 5 }],
};
const MILK = {
  id: "i1", code: 7, name: "Qumësht 1L", unit: "copë", salesUnit: undefined, salesUnitFactor: undefined, barcodes: ["3830001"], price: 0.95,
  taxDefinitionId: "t8", taxLetter: "D", taxRate: 0.08, tracksStock: true, trackLots: false, categoryId: undefined,
};

function renderTill() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/pos/till/r1"]}>
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

describe("Till", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.getPosBootstrap.mockResolvedValue(BOOT);
    api.getPosCatalog.mockResolvedValue([MILK]);
  });

  it("sells a scanned item for cash and shows the change and a training coupon", async () => {
    api.quotePosBasket.mockImplementation((_c: string, _r: string, body: { lines: { quantity: number }[]; payments?: { amount: number; tendered?: number }[] }) => {
      const qty = body.lines[0].quantity;
      const total = qty === 2 ? 1.9 : 0.95;
      const paid = (body.payments ?? []).reduce((s, p) => s + (p.tendered ?? p.amount), 0);
      return Promise.resolve({
        lines: [{ taxLetter: "D", gross: total, net: 0, tax: 0 }], taxes: [{ taxLetter: "D", taxRate: 0.08, gross: total, net: 1.76, tax: 0.14 }],
        total, totalTax: 0.14, totalDiscount: 0, paid, remaining: Math.max(0, total - paid), change: Math.max(0, paid - total), cashLimitExceeded: false,
      });
    });
    api.submitPosOrder.mockImplementation((_c: string, body: { clientUuid: string }) => Promise.resolve({
      id: "o1", clientUuid: body.clientUuid, number: "K1-000001", kind: 0, state: 0, orderedAt: "2026-10-31T09:00:00Z", operatorName: "Arta",
      customerId: undefined, originalOrderId: undefined, total: 1.9, totalTax: 0.14, totalDiscount: 0, change: 3.1, registerId: "r1",
      lines: [{ id: "l1", lineNo: 1, itemId: "i1", description: "Qumësht 1L", unit: "copë", quantity: 2, unitPrice: 0.95, discountAmount: 0, taxLetter: "D", gross: 1.9, net: 1.76, tax: 0.14, returnable: 2 }],
      payments: [{ paymentMethodId: "cash", name: "Arka", amount: 1.9, tendered: 5 }],
      taxes: [{ taxLetter: "D", taxRate: 0.08, gross: 1.9, net: 1.76, tax: 0.14 }],
      fiscal: { type: 9, couponId: 10010000000001, dailyNumber: 1, referenceCouponId: undefined, verificationNo: "ABC", issuedAt: "2026-10-31T09:00:00Z", qrCode: "x|y", atkStatus: 0, atkTransactionNo: undefined, atkError: undefined, sendBy: undefined },
    }));

    renderTill();
    expect(await screen.findByText("TRAINING — coupons are not fiscal")).toBeInTheDocument();
    const search = screen.getByLabelText("Scan a barcode or search…");
    // Scanned twice: one line, quantity 2, priced by the server.
    fireEvent.change(search, { target: { value: "3830001" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.change(search, { target: { value: "3830001" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("till-total")).toHaveTextContent("1.90"));
    expect(screen.getByLabelText("Qty")).toHaveValue(2);

    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    const dialog = await screen.findByRole("dialog");
    // Only counter tenders: on-account needs a named customer.
    expect(within(dialog).queryByRole("button", { name: "Me afat" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Cash given"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    const confirm = within(dialog).getByRole("button", { name: "Complete sale" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    const body = api.submitPosOrder.mock.calls[0][1];
    expect(body).toMatchObject({
      sessionId: "ss1", kind: 0,
      lines: [{ itemId: "i1", quantity: 2, unitPrice: 0.95, taxDefinitionId: "t8", discountAmount: 0 }],
      payments: [{ paymentMethodId: "cash", amount: 1.9, tendered: 5 }],
    });
    expect(await screen.findByText("Change: 3.10")).toBeInTheDocument();
    expect(screen.getAllByText("*** TRAINING — NOT A FISCAL COUPON ***")).toHaveLength(2);
    expect(screen.getByText("NUI: 811234567")).toBeInTheDocument();
    // The rate arrives as a fraction and prints as a percentage.
    expect(within(screen.getByTestId("coupon")).getByText("D 8%")).toBeInTheDocument();
  });

  it("says an unknown barcode was not found", async () => {
    api.scanPosCode.mockRejectedValue(new ApiException("Not Found", 404, "", {}, null));
    renderTill();
    const search = await screen.findByLabelText("Scan a barcode or search…");
    fireEvent.change(search, { target: { value: "999" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(await screen.findByText('No item matches "999".')).toBeInTheDocument();
    expect(api.scanPosCode).toHaveBeenCalledWith("c1", "r1", "999");
    expect(api.quotePosBasket).not.toHaveBeenCalled();
  });

  it("asks for the opening float when no session is open", async () => {
    api.getPosBootstrap.mockResolvedValue({ ...BOOT, session: undefined });
    api.openPosSession.mockResolvedValue(SESSION);
    renderTill();
    fireEvent.change(await screen.findByLabelText("Opening float"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));
    await waitFor(() => expect(api.openPosSession).toHaveBeenCalledWith("c1", "r1", { openingFloat: 50 }));
  });

  it("does not sell on a fiscal register without PAKO Station", async () => {
    api.getPosBootstrap.mockResolvedValue({ ...BOOT, register: { ...REGISTER, fiscalMode: 1 } });
    renderTill();
    expect(await screen.findByText(/signed on the till by PAKO Station/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Scan a barcode or search…")).not.toBeInTheDocument();
  });
});

// A quote that prices the basket at 0.95 a unit and counts cash at what was handed over. While
// `hold` is set, answers wait until released — to look at the till mid-request.
let hold = false;
let release: Array<() => void> = [];
function quoteBasket(_c: string, _r: string, body: { lines: { quantity: number }[]; payments?: { amount: number; tendered?: number }[] }) {
  const total = Math.round(body.lines.reduce((s, l) => s + l.quantity, 0) * 95) / 100;
  const paid = (body.payments ?? []).reduce((s, p) => s + (p.tendered ?? p.amount), 0);
  const answer = {
    lines: body.lines.map(() => ({ taxLetter: "D", gross: total, net: 0, tax: 0 })), taxes: [], total, totalTax: 0, totalDiscount: 0,
    paid, remaining: Math.max(0, Math.round((total - paid) * 100) / 100), change: Math.max(0, paid - total), cashLimitExceeded: false,
  };
  return hold ? new Promise((resolve) => release.push(() => resolve(answer))) : Promise.resolve(answer);
}

const recorded = (body: { clientUuid: string }) => ({
  id: "o1", clientUuid: body.clientUuid, number: "K1-000001", kind: 0, state: 0, orderedAt: "2026-10-31T09:00:00Z", operatorName: "Arta",
  customerId: undefined, originalOrderId: undefined, total: 0.95, totalTax: 0, totalDiscount: 0, change: 0, registerId: "r1",
  lines: [], payments: [{ paymentMethodId: "cash", name: "Arka", amount: 0.95, tendered: undefined }], taxes: [], fiscal: undefined,
});

async function scanMilk() {
  const search = await screen.findByLabelText("Scan a barcode or search…");
  fireEvent.change(search, { target: { value: "3830001" } });
  fireEvent.keyDown(search, { key: "Enter" });
  return search;
}

async function payExact() {
  await waitFor(() => expect(screen.getByRole("button", { name: /Pay/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
  const dialog = await screen.findByRole("dialog");
  const exact = within(dialog).getByRole("button", { name: "Exact amount" });
  await waitFor(() => expect(exact).toBeEnabled());
  fireEvent.click(exact);
  const confirm = within(dialog).getByRole("button", { name: "Complete sale" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  return dialog;
}

describe("Till — retries, guards and editing", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    hold = false;
    release = [];
    api.getPosBootstrap.mockResolvedValue(BOOT);
    api.getPosCatalog.mockResolvedValue([MILK]);
    api.quotePosBasket.mockImplementation(quoteBasket);
  });

  it("sends the same ClientUuid when a failed sale is paid again, and a new one for the next sale", async () => {
    api.submitPosOrder
      .mockRejectedValueOnce(new Error("The connection dropped."))
      .mockImplementation((_c: string, body: { clientUuid: string }) => Promise.resolve(recorded(body)));
    renderTill();
    await scanMilk();

    const dialog = await payExact();
    expect(await within(dialog).findByText("The connection dropped.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await payExact();
    fireEvent.click(await screen.findByRole("button", { name: "New sale" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await scanMilk();
    await payExact();
    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalledTimes(3));
    const uuids = api.submitPosOrder.mock.calls.map((c) => c[1].clientUuid);
    expect(uuids[1]).toBe(uuids[0]);
    expect(uuids[2]).not.toBe(uuids[0]);
  });

  it("does not open payment on F9 while the basket's quote is still on its way", async () => {
    renderTill();
    const search = await scanMilk();
    await waitFor(() => expect(screen.getByTestId("till-total")).toHaveTextContent("0.95"));

    // A second scan: the shown quote is the previous basket's until the new answer arrives.
    hold = true;
    fireEvent.change(search, { target: { value: "3830001" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(release.length).toBe(1));
    fireEvent.keyDown(search, { key: "F9" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay/ })).toBeDisabled();
    // No line shows a figure from the previous basket meanwhile.
    expect(within(screen.getAllByRole("listitem")[0]).getByText(/…/)).toBeInTheDocument();

    hold = false;
    release.forEach((r) => r());
    await waitFor(() => expect(screen.getByTestId("till-total")).toHaveTextContent("1.90"));
    fireEvent.keyDown(search, { key: "F9" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("removes later tenders with an earlier one, and blocks adding while the quote is pending", async () => {
    renderTill();
    await scanMilk();
    await scanMilk();
    await waitFor(() => expect(screen.getByTestId("till-total")).toHaveTextContent("1.90"));
    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Kartelë — POS" }));
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "1" } });
    hold = true;
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    // The remaining figure on screen is the old one: neither Add nor Exact may use it.
    await waitFor(() => expect(release.length).toBe(1));
    expect(within(dialog).getByRole("button", { name: "Exact amount" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    hold = false;
    release.forEach((r) => r());
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Exact amount" })).toBeEnabled());

    fireEvent.click(within(dialog).getByRole("button", { name: "Arka" }));
    fireEvent.change(within(dialog).getByLabelText("Cash given"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(within(dialog).getAllByRole("button", { name: "Remove" })).toHaveLength(2));

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Remove" })[0]);
    expect(within(dialog).queryAllByRole("button", { name: "Remove" })).toHaveLength(0);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Exact amount" })).toBeEnabled());
    expect(within(dialog).getByRole("button", { name: "Complete sale" })).toBeDisabled();
  });

  it("takes a fractional quantity typed through 0 and reverts an empty or zero one", async () => {
    renderTill();
    await scanMilk();
    const qty = await screen.findByLabelText("Qty");
    fireEvent.change(qty, { target: { value: "0" } });
    expect(qty).toHaveValue(0);
    fireEvent.change(qty, { target: { value: "0.5" } });
    fireEvent.keyDown(qty, { key: "Enter" });
    await waitFor(() => expect(api.quotePosBasket).toHaveBeenLastCalledWith("c1", "r1", { lines: [expect.objectContaining({ quantity: 0.5 })] }));
    expect(qty).toHaveValue(0.5);

    fireEvent.change(qty, { target: { value: "" } });
    fireEvent.blur(qty);
    expect(qty).toHaveValue(0.5);
    fireEvent.change(qty, { target: { value: "0" } });
    fireEvent.blur(qty);
    expect(qty).toHaveValue(0.5);
  });

  it("keeps focus in the search box after a tile is clicked", async () => {
    renderTill();
    const search = await screen.findByLabelText("Scan a barcode or search…");
    const tile = await screen.findByRole("button", { name: /Qumësht 1L/ });
    fireEvent.mouseDown(tile);
    fireEvent.click(tile);
    expect(search).toHaveFocus();
  });

  it("tells a user without POS write access that they cannot sell here", async () => {
    access.canWrite = () => false;
    try {
      renderTill();
      expect(await screen.findByText(/no POS write access/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Scan a barcode or search…")).not.toBeInTheDocument();
    } finally {
      access.canWrite = (module: string) => module !== "";
    }
  });
});

// P2 grocery: in-store labels, weighed and open-priced items, age checks and deposits.
const CHEESE = { ...MILK, id: "i2", code: 8, name: "Djathë i bardhë", unit: "kg", barcodes: [], price: 6.5, plu: "12", sellByWeight: true };
const BOTTLE = { ...MILK, id: "dep", code: 9, name: "Depozita e shishes", barcodes: ["9990001"], price: 0.1 };
const BEER = { ...MILK, id: "i3", code: 10, name: "Birrë Peja 0.5L", barcodes: ["3830099"], price: 0.8, minimumAge: 18, depositItemId: "dep" };
const WATER = { ...MILK, id: "i4", code: 11, name: "Ujë 1.5L", barcodes: ["3830050"], price: 0.4, depositItemId: "dep" };

type QuoteBody = { lines: { itemId: string; quantity: number; unitPrice: number; ageVerified?: boolean }[] };
const lastQuoteLines = () => (api.quotePosBasket.mock.lastCall?.[2] as QuoteBody | undefined)?.lines ?? [];

async function scan(code: string) {
  const search = await screen.findByLabelText("Scan a barcode or search…");
  fireEvent.change(search, { target: { value: code } });
  fireEvent.keyDown(search, { key: "Enter" });
  return search;
}

describe("Till — grocery (P2)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    hold = false;
    release = [];
    api.getPosBootstrap.mockResolvedValue(BOOT);
    api.getPosCatalog.mockResolvedValue([MILK, CHEESE, BOTTLE, BEER, WATER]);
    api.quotePosBasket.mockImplementation(quoteBasket);
  });

  it("asks the server about a code the catalogue doesn't know and adds the weighed line it decodes", async () => {
    api.scanPosCode.mockResolvedValue({ item: CHEESE, match: "weight", quantity: 0.734, unitPrice: undefined });
    renderTill();
    await scan("2100012007349");
    await waitFor(() => expect(api.scanPosCode).toHaveBeenCalledWith("c1", "r1", "2100012007349"));
    // The label carries the weight: no weight prompt, the line takes the decoded quantity at the item's price.
    await waitFor(() => expect(lastQuoteLines()).toEqual([expect.objectContaining({ itemId: "i2", quantity: 0.734, unitPrice: 6.5 })]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts the price printed on a price label on the line, quantity 1", async () => {
    api.scanPosCode.mockResolvedValue({ item: CHEESE, match: "price", quantity: 1, unitPrice: 4.77 });
    renderTill();
    await scan("2200012004770");
    await waitFor(() => expect(lastQuoteLines()).toEqual([expect.objectContaining({ itemId: "i2", quantity: 1, unitPrice: 4.77 })]));
  });

  it("asks the weight of an item sold by weight picked without a label", async () => {
    renderTill();
    const tile = await screen.findByRole("button", { name: /Djathë i bardhë/ });
    fireEvent.click(tile);
    const dialog = await screen.findByRole("dialog");
    const weight = within(dialog).getByLabelText("Weight (kg)");
    fireEvent.change(weight, { target: { value: "0.5555" } });
    fireEvent.submit(weight.closest("form") as HTMLFormElement);
    expect(await within(dialog).findByText(/up to 3 decimals/)).toBeInTheDocument();
    fireEvent.change(weight, { target: { value: "0.555" } });
    fireEvent.submit(weight.closest("form") as HTMLFormElement);
    await waitFor(() => expect(lastQuoteLines()).toEqual([expect.objectContaining({ itemId: "i2", quantity: 0.555 })]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Scan a barcode or search…")).toHaveFocus();
  });

  it("asks for the customer's age and sends ageVerified, or adds nothing on No", async () => {
    renderTill();
    await scan("3830099");
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Is the customer 18+?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "No" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.quotePosBasket).not.toHaveBeenCalled();

    await scan("3830099");
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(lastQuoteLines()[0]).toMatchObject({ itemId: "i3", ageVerified: true }));
    // The deposit line follows, without an age flag of its own.
    expect(lastQuoteLines()[1]).toMatchObject({ itemId: "dep", quantity: 1, unitPrice: 0.1 });
    expect(lastQuoteLines()[1].ageVerified).toBeUndefined();

    // The same customer isn't asked again for a second one.
    await scan("3830099");
    await waitFor(() => expect(lastQuoteLines()[0]).toMatchObject({ itemId: "i3", quantity: 2, ageVerified: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps a deposit line after its item, following its quantity and removed with it", async () => {
    renderTill();
    await scan("3830050");
    await waitFor(() => expect(lastQuoteLines()).toEqual([
      expect.objectContaining({ itemId: "i4", quantity: 1 }),
      expect.objectContaining({ itemId: "dep", quantity: 1, unitPrice: 0.1 }),
    ]));
    expect(screen.getByTestId("deposit-line")).toHaveTextContent("Depozita e shishes");

    const qty = screen.getByLabelText("Qty");
    fireEvent.change(qty, { target: { value: "6" } });
    fireEvent.keyDown(qty, { key: "Enter" });
    await waitFor(() => expect(lastQuoteLines()).toEqual([
      expect.objectContaining({ itemId: "i4", quantity: 6 }),
      expect.objectContaining({ itemId: "dep", quantity: 6 }),
    ]));

    // Another item in between: the deposit stays right after its own line.
    await scan("3830001");
    await waitFor(() => expect(lastQuoteLines().map((l) => l.itemId)).toEqual(["i4", "dep", "i1"]));

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await waitFor(() => expect(lastQuoteLines().map((l) => l.itemId)).toEqual(["i1"]));
    expect(screen.queryByTestId("deposit-line")).not.toBeInTheDocument();
  });
});

describe("POS setup", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listPosStores.mockResolvedValue([STORE]);
    api.listPosRegisters.mockResolvedValue([{ ...REGISTER, fiscalMode: 1 }]);
    api.listPosBarcodeRules.mockResolvedValue([]);
  });

  it("lists stores and registers, flagging a fiscal till with no ATK certificate", async () => {
    renderWith(<PosSetup />);
    expect(await screen.findByText("Prishtina 1", { selector: "span" })).toBeInTheDocument();
    expect(await screen.findByText("Arka 1")).toBeInTheDocument();
    expect(screen.getByText("No ATK certificate")).toBeInTheDocument();
  });

  it("lists barcode rules, says the defaults apply with none, and creates one", async () => {
    api.createPosBarcodeRule.mockResolvedValue({ id: "br1", prefix: "23", kind: 2, itemDigits: 5, valueDigits: 5, valueDecimals: 0, isActive: true });
    renderWith(<PosSetup />);
    expect(await screen.findByText("No rules — the defaults 21 (weight) and 22 (price) apply.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New rule" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Prefix"), { target: { value: "23" } });
    fireEvent.change(within(dialog).getByLabelText("Decimals"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.createPosBarcodeRule).toHaveBeenCalledWith("c1", { prefix: "23", kind: 0, itemDigits: 5, valueDigits: 5, valueDecimals: 2, isActive: true }),
    );
  });
});

// P2: promotions, coupons, loyalty and gift cards — the till sends what the cashier entered and
// shows what the server answered.
type SaleBody = {
  lines: { itemId?: string; quantity: number; unitPrice: number; description: string; giftCardNumber?: string }[];
  payments?: { paymentMethodId: string; amount: number; tendered?: number; reference?: string }[];
  couponCodes?: string[];
  loyaltyCardNumber?: string;
  redeemPoints?: number;
};
const lastQuote = () => api.quotePosBasket.mock.lastCall?.[2] as SaleBody;

async function quoteWithPrograms(c: string, r: string, body: SaleBody) {
  const answer = (await quoteBasket(c, r, body as never)) as { lines: Record<string, unknown>[] } & Record<string, unknown>;
  const codes = body.couponCodes ?? [];
  return {
    ...answer,
    lines: answer.lines.map((l) => (codes.includes("SUMMER10") ? { ...l, programDiscount: 0.1, programName: "Summer 10 %" } : l)),
    programs: codes.includes("SUMMER10") ? [{ programId: "p1", name: "Summer 10 %", discount: 0.1 }] : [],
    unknownCodes: codes.filter((x) => x !== "SUMMER10"),
    pointsRedeemed: body.redeemPoints ?? 0,
    loyaltyCard: body.loyaltyCardNumber === "L-1"
      ? { id: "lc1", number: "L-1", holderName: "Arta Krasniqi", phone: undefined, partnerId: undefined, points: 120, isActive: true }
      : undefined,
  };
}

describe("Till — programs, loyalty and gift cards (P2)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    hold = false;
    release = [];
    api.getPosBootstrap.mockResolvedValue({ ...BOOT, tenders: [...BOOT.tenders, { id: "gift", name: "Kartelë dhuratë", kind: 4 }] });
    api.getPosCatalog.mockResolvedValue([MILK]);
    api.quotePosBasket.mockImplementation(quoteWithPrograms);
    api.submitPosOrder.mockImplementation((_c: string, body: { clientUuid: string }) => Promise.resolve(recorded(body)));
  });

  async function enterCode(code: string) {
    fireEvent.click(screen.getByRole("button", { name: "Coupon" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: code } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add code" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }

  it("sends coupon codes with every quote and the order, and warns about codes that gave nothing", async () => {
    renderTill();
    await scanMilk();
    await waitFor(() => expect(screen.getByTestId("till-total")).toHaveTextContent("0.95"));
    await enterCode("SUMMER10");
    await enterCode("NOPE");
    await waitFor(() => expect(lastQuote().couponCodes).toEqual(["SUMMER10", "NOPE"]));
    expect(await screen.findByText(/No discount from: NOPE\./)).toBeInTheDocument();
    // The line shows the program and its discount, as the server gave them.
    expect(await screen.findByTestId("line-program")).toHaveTextContent("Summer 10 %−0.10");

    // A code removed is no longer sent.
    fireEvent.click(screen.getByRole("button", { name: "Remove code NOPE" }));
    await waitFor(() => expect(lastQuote().couponCodes).toEqual(["SUMMER10"]));
    await waitFor(() => expect(screen.queryByText(/No discount from/)).not.toBeInTheDocument());

    await payExact();
    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    expect(api.submitPosOrder.mock.calls[0][1]).toMatchObject({ couponCodes: ["SUMMER10"] });
  });

  it("sends the loyalty card and the points to redeem, and shows the holder and points", async () => {
    renderTill();
    await scanMilk();
    fireEvent.click(await screen.findByRole("button", { name: "Loyalty card" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Card number"), { target: { value: "L-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use card" }));
    await waitFor(() => expect(lastQuote().loyaltyCardNumber).toBe("L-1"));
    expect(await screen.findByText("120 points")).toBeInTheDocument();
    expect(screen.getByText(/Arta Krasniqi/)).toBeInTheDocument();

    const redeem = screen.getByLabelText("Redeem points");
    fireEvent.change(redeem, { target: { value: "50" } });
    fireEvent.keyDown(redeem, { key: "Enter" });
    await waitFor(() => expect(lastQuote()).toMatchObject({ loyaltyCardNumber: "L-1", redeemPoints: 50 }));
    expect(await screen.findByText("Points redeemed: 50")).toBeInTheDocument();

    await payExact();
    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    expect(api.submitPosOrder.mock.calls[0][1]).toMatchObject({ loyaltyCardNumber: "L-1", redeemPoints: 50 });
  });

  it("issues a new loyalty card from the till", async () => {
    api.createLoyaltyCard.mockResolvedValue({ id: "lc9", number: "000123", holderName: "Besa", phone: undefined, partnerId: undefined, points: 0, isActive: true });
    renderTill();
    await scanMilk();
    fireEvent.click(await screen.findByRole("button", { name: "Loyalty card" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "New card" }));
    fireEvent.change(within(dialog).getByLabelText("Holder"), { target: { value: "Besa" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue card" }));
    await waitFor(() => expect(api.createLoyaltyCard).toHaveBeenCalledWith("c1", expect.objectContaining({ number: undefined, holderName: "Besa" })));
    await waitFor(() => expect(lastQuote().loyaltyCardNumber).toBe("000123"));
  });

  it("sells a gift card as a line with no item, quantity 1 and the amount typed", async () => {
    renderTill();
    fireEvent.click(await screen.findByRole("button", { name: "Sell gift card" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Amount loaded (€)"), { target: { value: "20" } });
    fireEvent.change(within(dialog).getByLabelText("Card number (optional)"), { target: { value: "GC-9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    const line = lastQuote().lines[0];
    expect(line).toMatchObject({ quantity: 1, unitPrice: 20, giftCardNumber: "GC-9", description: "Gift card" });
    expect(line.itemId).toBeUndefined();
    // No quantity or discount to edit on it.
    expect(screen.queryByLabelText("Qty")).not.toBeInTheDocument();
  });

  it("pays with a gift card: shows its balance and sends the number as the reference", async () => {
    api.getGiftCard.mockResolvedValue({ id: "g1", number: "GC-1", kind: 0, balance: 20, expiresOn: undefined, isActive: true, createdAt: "2026-10-01T09:00:00Z", movements: [] });
    api.submitPosOrder.mockImplementation((_c: string, body: { clientUuid: string }) => Promise.resolve({
      ...recorded(body), cards: [{ number: "GC-1", kind: 0, change: -0.95, balance: 19.05 }], pointsEarned: 1, pointsRedeemed: 0, pointsBalance: 121,
    }));
    renderTill();
    await scanMilk();
    await waitFor(() => expect(screen.getByRole("button", { name: /Pay/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Kartelë dhuratë" }));
    fireEvent.change(within(dialog).getByLabelText("Gift card number"), { target: { value: "GC-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Check balance" }));
    expect(await within(dialog).findByTestId("gift-card-balance")).toHaveTextContent("Gift card GC-1: balance 20.00");
    expect(api.getGiftCard).toHaveBeenCalledWith("c1", "GC-1");

    const exact = within(dialog).getByRole("button", { name: "Exact amount" });
    await waitFor(() => expect(exact).toBeEnabled());
    fireEvent.click(exact);
    const confirm = within(dialog).getByRole("button", { name: "Complete sale" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    expect(api.submitPosOrder.mock.calls[0][1].payments).toEqual([{ paymentMethodId: "gift", amount: 0.95, tendered: undefined, reference: "GC-1" }]);

    // The coupon lists the card spent and its balance, and the loyalty points.
    const cards = await screen.findByTestId("coupon-cards");
    expect(within(cards).getByText("Spent")).toBeInTheDocument();
    expect(within(cards).getByText("19.05")).toBeInTheDocument();
    expect(within(screen.getByTestId("coupon-loyalty")).getByText("121")).toBeInTheDocument();
  });
});

describe("Programs", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listPosStores.mockResolvedValue([STORE]);
    api.listItemCategories.mockResolvedValue([]);
    api.itemsGET.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
    api.listPosPrograms.mockResolvedValue([{
      id: "p1", name: "Ujë 3 për 1", kind: 0, reward: 4, isActive: true, validFrom: undefined, validTo: undefined, days: 0, timeFrom: undefined,
      timeTo: undefined, storeId: undefined, priority: 100, stackable: false, code: undefined, maxUses: undefined, uses: 4, minQuantity: undefined,
      minAmount: undefined, percent: undefined, amount: undefined, price: 1, buyQuantity: 3, getQuantity: undefined, pointsPerEuro: undefined,
      pointValue: undefined, itemIds: [], categoryIds: [],
    }]);
  });

  it("lists programs with a reward summary and creates one with the days as a bitmask", async () => {
    api.createPosProgram.mockResolvedValue({ id: "p2" });
    renderWith(<PosPrograms />);
    expect(await screen.findByText("3 for 1.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New program" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Happy hour" } });
    fireEvent.change(within(dialog).getByLabelText("Percent"), { target: { value: "10" } });
    fireEvent.click(within(dialog).getByLabelText("Mon"));
    fireEvent.click(within(dialog).getByLabelText("Fri"));
    fireEvent.click(within(dialog).getByLabelText("Sun"));
    fireEvent.change(within(dialog).getByLabelText("From hour"), { target: { value: "17:00" } });
    fireEvent.change(within(dialog).getByLabelText("To hour"), { target: { value: "19:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createPosProgram).toHaveBeenCalled());
    expect(api.createPosProgram).toHaveBeenCalledWith("c1", expect.objectContaining({
      name: "Happy hour", kind: 0, reward: 0, percent: 10, days: 1 | 16 | 64, timeFrom: "17:00:00", timeTo: "19:00:00",
      storeId: undefined, priority: 100, itemIds: [], categoryIds: [], isActive: true,
    }));
    const body = api.createPosProgram.mock.calls[0][1];
    expect(body.amount).toBeUndefined();
    expect(body.pointsPerEuro).toBeUndefined();
  });
});
