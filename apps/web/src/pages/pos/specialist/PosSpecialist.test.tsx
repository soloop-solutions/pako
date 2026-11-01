import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { todayLocal } from "@/lib/pos-services";
import { Till } from "@/pages/pos/Till";
import { Forecourt } from "@/pages/pos/specialist/Forecourt";
import { OnlineSales } from "@/pages/pos/specialist/OnlineSales";

// docs/POS_PLAN.md P7 specialist retail at the till and in the back office, against a mocked
// generated client (same pattern as PosRetail.test.tsx).
const api = vi.hoisted(() => ({
  getPosBootstrap: vi.fn(),
  getPosCatalog: vi.fn(),
  quotePosBasket: vi.fn(),
  submitPosOrder: vi.fn(),
  scanPosCode: vi.fn(),
  listPosPrescriptions: vi.fn(),
  listPosPayers: vi.fn(),
  listPosFuelNozzles: vi.fn(),
  lookupPosFleetCard: vi.fn(),
  getPosChannelOrder: vi.fn(),
  savePosMeterReadings: vi.fn(),
  getPosCodReport: vi.fn(),
  remitPosCod: vi.fn(),
  listPosStores: vi.fn(),
  listPosRegisters: vi.fn(),
  posPinSignIn: vi.fn(),
  partnersAll: vi.fn(),
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
const register = (profile: number) => ({
  id: "r1", storeId: "s1", storeName: "Prishtina 1", code: "K1", name: "Arka 1", profile, fiscalMode: 0, fiscalPosNumber: 1,
  fiscalizationNumber: undefined, cashAccountId: "a1", isActive: true, certificateNotAfter: undefined, openSessionId: "ss1",
});
const SESSION = { id: "ss1", registerId: "r1", registerCode: "K1", number: 1, state: 0, businessDate: "2026-11-01", openedAt: "2026-11-01T08:00:00Z", closedAt: undefined, netSales: 0, journalEntryId: undefined };
const boot = (profile = 0) => ({
  register: register(profile), store: STORE, session: SESSION, cashLimitB2C: 2000, companyName: "Shop Co", fiscalNumber: "811234567", vatNumber: undefined,
  tenders: [{ id: "cash", name: "Arka", kind: 0 }, { id: "card", name: "Kartelë", kind: 2 }, { id: "acct", name: "Në llogari", kind: 5 }],
});
const base = {
  unit: "copë", salesUnit: undefined, salesUnitFactor: undefined, taxDefinitionId: "t8", taxLetter: "D", taxRate: 0.08,
  tracksStock: true, trackLots: true, categoryId: undefined,
};
const MED = { ...base, id: "m1", code: 11, name: "Amoksicilinë 500mg", barcodes: ["111"], price: 1 };
const DIESEL = { ...base, id: "d1", code: 31, name: "Diesel", unit: "l", barcodes: [], price: 1.5 };
const BEER = { ...base, id: "b1", code: 41, name: "Birra Peja", barcodes: ["441"], price: 1.2, minimumAge: 18 };

type Body = {
  lines: { itemId?: string; quantity: number; unitPrice: number }[];
  payments?: { amount: number; tendered?: number }[];
  prescriptionId?: string;
  fleetCardNumber?: string;
  channelOrderId?: string;
};
const round = (v: number) => Math.round(v * 100) / 100;
// The mock server's pricing and its tender partners (a test fixture, not the browser's).
let partners: (body: Body, total: number) => { partnerId: string; name: string; max: number | undefined }[] = () => [];
function quote(_c: string, _r: string, body: Body) {
  const total = round(body.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const paid = round((body.payments ?? []).reduce((s, p) => s + (p.tendered ?? p.amount), 0));
  return Promise.resolve({
    lines: body.lines.map((l) => ({ taxLetter: "D", gross: round(l.quantity * l.unitPrice), net: 0, tax: 0 })), taxes: [], total, totalTax: 0, totalDiscount: 0,
    paid, remaining: Math.max(0, round(total - paid)), change: Math.max(0, round(paid - total)), cashLimitExceeded: false,
    tenderPartners: partners(body, total),
  });
}
const lastQuote = () => api.quotePosBasket.mock.lastCall?.[2] as Body & { lines: Record<string, unknown>[] };
const recorded = (body: { clientUuid: string }) => ({
  id: "o1", clientUuid: body.clientUuid, number: "K1-000001", kind: 0, state: 0, orderedAt: "2026-11-01T09:00:00Z", operatorName: "Arta",
  customerId: undefined, originalOrderId: undefined, total: 2, totalTax: 0, totalDiscount: 0, change: 0, registerId: "r1",
  lines: [], payments: [], taxes: [], fiscal: undefined,
});

function renderAt(url: string, path: string, element: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path={path} element={element} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}
const renderTill = (url = "/pos/till/r1") => renderAt(url, "/pos/till/:registerId", <Till />);

/** Pays the partner offer, then the rest in cash, and completes the sale. */
async function payWithPartner(partnerText: string, cashRest: boolean) {
  const payButton = screen.getByRole("button", { name: /Pay \(F9\)/ });
  await waitFor(() => expect(payButton).toBeEnabled());
  fireEvent.click(payButton);
  const pay = await screen.findByRole("dialog");
  const offer = await within(pay).findByTestId("partner-tender");
  expect(offer).toHaveTextContent(partnerText);
  const charge = within(offer).getByRole("button", { name: "Charge on account" });
  await waitFor(() => expect(charge).toBeEnabled());
  fireEvent.click(charge);
  await waitFor(() => expect(within(pay).queryByTestId("partner-tender")).not.toBeInTheDocument());
  if (cashRest) {
    const exact = within(pay).getByRole("button", { name: "Exact amount" });
    await waitFor(() => expect(exact).toBeEnabled());
    fireEvent.click(exact);
  }
  const confirm = within(pay).getByRole("button", { name: "Complete sale" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
  return api.submitPosOrder.mock.calls[0][1];
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  partners = () => [];
  api.getPosCatalog.mockResolvedValue([MED, DIESEL, BEER]);
  api.quotePosBasket.mockImplementation(quote);
  api.submitPosOrder.mockImplementation((_c: string, body: { clientUuid: string }) => Promise.resolve(recorded(body)));
  api.listPosStores.mockResolvedValue([STORE]);
  api.listPosRegisters.mockResolvedValue([register(0)]);
  api.listPosPayers.mockResolvedValue([]);
  api.partnersAll.mockResolvedValue([]);
});

describe("Till — pharmacy (P7)", () => {
  it("dispenses a prescription against its lines and charges the payer's share from the quote", async () => {
    api.getPosBootstrap.mockResolvedValue(boot());
    api.listPosPrescriptions.mockResolvedValue({
      items: [{
        id: "rx1", storeId: "s1", number: "RX-77", issuedOn: "2026-10-30", validUntil: undefined, prescriber: "Dr. Gashi", prescriberLicence: undefined,
        patientName: "Arbër Krasniqi", patientPersonalNumber: undefined, payerId: "py1", payerName: "FSSH", payerPartnerId: "p-fssh", coveragePercent: 80,
        state: 1, notes: undefined, createdAt: "2026-10-30T10:00:00Z",
        lines: [
          { id: "rl1", itemId: "m1", itemName: "Amoksicilinë 500mg", quantity: 3, dispensed: 1, remaining: 2, dosage: "3×1" },
          { id: "rl2", itemId: "m1", itemName: "Amoksicilinë 500mg", quantity: 1, dispensed: 1, remaining: 0, dosage: undefined },
        ],
      }],
      total: 1, page: 1, pageSize: 50,
    });
    // The payer's share: 80% of the prescription lines (the server's figure).
    partners = (body, total) => (body.prescriptionId === "rx1" ? [{ partnerId: "p-fssh", name: "FSSH", max: round(total * 0.8) }] : []);
    renderTill();
    fireEvent.click(await screen.findByRole("button", { name: "Prescription" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByTestId("till-prescription"));

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "m1", quantity: 2, unitPrice: 1, prescriptionLineId: "rl1" });
    expect(lastQuote().prescriptionId).toBe("rx1");
    expect(screen.getByTestId("dispensing-prescription")).toHaveTextContent("RX-77");
    expect(screen.getByTestId("line-rx")).toBeInTheDocument();

    const body = await payWithPartner("FSSH pays up to 1.60", true);
    expect(body.prescriptionId).toBe("rx1");
    expect(body.lines[0]).toMatchObject({ prescriptionLineId: "rl1" });
    expect(body.payments[0]).toMatchObject({ paymentMethodId: "acct", amount: 1.6, partnerId: "p-fssh" });
    expect(body.payments[1]).toMatchObject({ paymentMethodId: "cash", amount: 0.4 });
    expect(body.payments[1].partnerId).toBeUndefined();
  });

  it("puts the lot and serial of a GS1 code on the line and flags an expired pack", async () => {
    api.getPosBootstrap.mockResolvedValue(boot());
    api.scanPosCode.mockResolvedValue({
      item: MED, match: "gs1", quantity: undefined, unitPrice: undefined, lotNumber: "L2309", expiryDate: "2025-12-31", serialNumber: "SN-0042",
    });
    renderTill();
    const search = await screen.findByLabelText("Scan a barcode or search…");
    fireEvent.change(search, { target: { value: "0103830012345678172512311 0L2309" } });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "m1", quantity: 1, lotNumber: "L2309", serialNumber: "SN-0042" });
    expect(screen.getByTestId("line-lot")).toHaveTextContent("L2309");
    expect(screen.getByTestId("line-expiry")).toHaveTextContent("EXPIRED");
    expect(screen.getByText(/expired on/)).toBeInTheDocument();
  });
});

describe("Till — fuel station (P7)", () => {
  it("adds a fill on a nozzle in litres, uses a fleet card and charges its company", async () => {
    api.getPosBootstrap.mockResolvedValue(boot(5));
    api.listPosFuelNozzles.mockResolvedValue([
      { id: "n1", storeId: "s1", pump: 1, number: 2, tankId: "t1", tankName: "T1", itemId: "d1", itemName: "Diesel", isActive: true, lastClosing: 1000 },
    ]);
    api.lookupPosFleetCard.mockResolvedValue({
      id: "fc1", number: "FC-1", partnerId: "p-co", partnerName: "Trans Co", vehiclePlate: "01-123-AB", driverName: "Besnik", limitPerFill: 100, fuelOnly: true, isActive: true,
    });
    partners = (body, total) => (body.fleetCardNumber === "FC-1" ? [{ partnerId: "p-co", name: "Trans Co", max: Math.min(100, total) }] : []);
    renderTill();
    fireEvent.click(await screen.findByRole("button", { name: /1·2/ }));
    const prompt = await screen.findByRole("dialog");
    fireEvent.change(within(prompt).getByLabelText("Litres (as on the pump)"), { target: { value: "40" } });
    fireEvent.click(within(prompt).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "d1", quantity: 40, unitPrice: 1.5, nozzleId: "n1" });

    fireEvent.click(screen.getByRole("button", { name: "Fleet card" }));
    const fleet = await screen.findByRole("dialog");
    fireEvent.change(within(fleet).getByLabelText("Card number"), { target: { value: "FC-1" } });
    fireEvent.click(within(fleet).getByRole("button", { name: "Check" }));
    expect(await within(fleet).findByTestId("fleet-card")).toHaveTextContent("Trans Co");
    fireEvent.click(within(fleet).getByRole("button", { name: "Use card" }));
    await waitFor(() => expect(lastQuote().fleetCardNumber).toBe("FC-1"));
    expect(api.lookupPosFleetCard).toHaveBeenCalledWith("c1", "FC-1");

    const body = await payWithPartner("Trans Co pays up to 60.00", false);
    expect(body.fleetCardNumber).toBe("FC-1");
    expect(body.lines[0]).toMatchObject({ nozzleId: "n1", quantity: 40 });
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ paymentMethodId: "acct", amount: 60, partnerId: "p-co" });
  });
});

describe("Till — online order checkout (P7)", () => {
  it("loads ?channelOrder= at the order's prices and charges cash on delivery to the courier", async () => {
    api.getPosBootstrap.mockResolvedValue(boot());
    api.getPosChannelOrder.mockResolvedValue({
      id: "co1", channelId: "ch1", channelName: "Webshop", storeId: "s1", number: "WEB-000001", externalRef: "W-55", state: 2, fulfilment: 1, payment: 1,
      customerName: "Drita", phone: undefined, email: undefined, address: "Rr. Nëna Terezë 1", city: "Prishtinë", notes: undefined, total: 5.8, shippingFee: 2,
      courierPartnerId: "p-post", courierName: "Postex", trackingNumber: undefined, posOrderId: undefined, posOrderNumber: undefined, remittedOn: undefined,
      remittanceRef: undefined, createdAt: "2026-11-01T08:00:00Z",
      lines: [{ id: "cl1", lineNo: 1, itemId: "m1", description: "Amoksicilinë 500mg", quantity: 2, unitPrice: 1.9, total: 3.8 }],
    });
    partners = (body, total) => (body.channelOrderId === "co1" ? [{ partnerId: "p-post", name: "Postex", max: total }] : []);
    renderTill("/pos/till/r1?channelOrder=co1");

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "m1", quantity: 2, unitPrice: 1.9 });
    expect(lastQuote().channelOrderId).toBe("co1");
    const banner = screen.getByTestId("till-channel-order");
    expect(banner).toHaveTextContent("WEB-000001");
    expect(within(banner).getByTestId("till-shipping")).toHaveTextContent("2.00");

    const body = await payWithPartner("Postex pays up to 3.80", false);
    expect(body.channelOrderId).toBe("co1");
    expect(body.payments[0]).toMatchObject({ paymentMethodId: "acct", amount: 3.8, partnerId: "p-post" });
  });
});

describe("Self-checkout lane (P7)", () => {
  it("holds an age-restricted item for the attendant's PIN, then pays the server's total by card", async () => {
    api.getPosBootstrap.mockResolvedValue(boot(6));
    api.posPinSignIn.mockResolvedValue({ userId: "u2", name: "Arta", token: "tok", expiresAt: "2026-11-01T20:00:00Z" });
    renderTill();
    const scan = await screen.findByLabelText("Scan a barcode or type a product name");
    fireEvent.change(scan, { target: { value: "441" } });
    fireEvent.keyDown(scan, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "Call attendant" }));
    expect(api.quotePosBasket).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Attendant PIN"), { target: { value: "1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(api.posPinSignIn).toHaveBeenCalledWith("c1", { pin: "1234" });
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "b1", ageVerified: true });
    const payCard = screen.getByRole("button", { name: "Pay by card" });
    await waitFor(() => expect(payCard).toBeEnabled());
    fireEvent.click(payCard);
    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    expect(api.submitPosOrder.mock.calls[0][1].payments).toEqual([{ paymentMethodId: "card", amount: 1.2 }]);
  });
});

describe("Forecourt — shift readings (P7)", () => {
  it("prefills the opening meter from the last closing and posts the readings", async () => {
    api.listPosFuelNozzles.mockResolvedValue([
      { id: "n1", storeId: "s1", pump: 1, number: 1, tankId: "t1", tankName: "T1", itemId: "d1", itemName: "Diesel", isActive: true, lastClosing: 1000.5 },
      { id: "n2", storeId: "s1", pump: 1, number: 2, tankId: "t2", tankName: "T2", itemId: "g1", itemName: "Benzinë", isActive: true, lastClosing: undefined },
    ]);
    api.savePosMeterReadings.mockResolvedValue({
      storeId: "s1", date: todayLocal(), grades: [],
      nozzles: [{ nozzleId: "n1", pump: 1, number: 1, itemName: "Diesel", pumped: 40, sold: 39.5, difference: -0.5 }],
    });
    renderAt("/pos/forecourt?store=s1", "/pos/forecourt", <Forecourt />);
    const opening = await screen.findByLabelText("Opening meter, nozzle 1·1");
    expect(opening).toHaveValue("1000.5");
    expect(screen.getByLabelText("Opening meter, nozzle 1·2")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Closing meter, nozzle 1·1"), { target: { value: "1040.5" } });
    fireEvent.change(screen.getByLabelText("Opening meter, nozzle 1·2"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Closing meter, nozzle 1·2"), { target: { value: "12,25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save readings" }));

    await waitFor(() => expect(api.savePosMeterReadings).toHaveBeenCalled());
    expect(api.savePosMeterReadings).toHaveBeenCalledWith("c1", {
      storeId: "s1", date: todayLocal(),
      readings: [{ nozzleId: "n1", opening: 1000.5, closing: 1040.5 }, { nozzleId: "n2", opening: 0, closing: 12.25 }],
    });
    expect(await screen.findByTestId("readings-result")).toHaveTextContent("-0.5");
  });
});

describe("Online sales — cash on delivery (P7)", () => {
  it("remits the orders ticked on the courier's statement", async () => {
    const order = (id: string, number: string) => ({
      id, channelId: "ch1", channelName: "Webshop", storeId: "s1", number, externalRef: `X-${id}`, state: 3, fulfilment: 1, payment: 1, customerName: "Drita",
      phone: undefined, email: undefined, address: undefined, city: undefined, notes: undefined, total: 10, shippingFee: 0, courierPartnerId: "p-post",
      courierName: "Postex", trackingNumber: undefined, posOrderId: `po-${id}`, posOrderNumber: `K1-${id}`, remittedOn: undefined, remittanceRef: undefined,
      createdAt: "2026-10-31T08:00:00Z", lines: [],
    });
    api.getPosCodReport.mockResolvedValue({
      couriers: [{ courierPartnerId: "p-post", courierName: "Postex", orders: 2, amount: 20, oldestDispatch: "2026-10-31" }],
      orders: [order("a1", "WEB-1"), order("a2", "WEB-2")],
    });
    api.remitPosCod.mockResolvedValue({ couriers: [], orders: [] });
    renderAt("/pos/online?tab=cod", "/pos/online", <OnlineSales />);
    await screen.findByText("WEB-2");
    const rows = screen.getAllByLabelText("Select row");
    fireEvent.click(rows[1]);
    fireEvent.click(screen.getByRole("button", { name: "Record remittance (1)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Statement / reference"), { target: { value: "PX-1031" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));

    await waitFor(() => expect(api.remitPosCod).toHaveBeenCalled());
    expect(api.remitPosCod).toHaveBeenCalledWith("c1", { orderIds: ["a2"], remittedOn: todayLocal(), reference: "PX-1031" });
  });
});
