import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { BookingDialog } from "@/pages/pos/Appointments";
import { PublicBooking } from "@/pages/pos/PublicBooking";
import { RepairDialog } from "@/pages/pos/Repairs";
import { Till } from "@/pages/pos/Till";

// docs/POS_PLAN.md P4 services: booking, checking an appointment out at the till, package
// sessions, repair intake and online booking — against a mocked generated client (same pattern as
// PosRetail.test.tsx).
const api = vi.hoisted(() => ({
  getPosBootstrap: vi.fn(),
  getPosCatalog: vi.fn(),
  quotePosBasket: vi.fn(),
  submitPosOrder: vi.fn(),
  listPosAppointments: vi.fn(),
  listPosResources: vi.fn(),
  listPosPackages: vi.fn(),
  getPosAvailability: vi.fn(),
  createPosAppointment: vi.fn(),
  itemsGET: vi.fn(),
  partnersAll: vi.fn(),
  listPosStores: vi.fn(),
  listPosRegisters: vi.fn(),
  membersAll: vi.fn(),
  createPosRepair: vi.fn(),
  getPosRepair: vi.fn(),
  getPublicBooking: vi.fn(),
  getPublicAvailability: vi.fn(),
  bookPublicAppointment: vi.fn(),
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
  id: "s1", code: "PR1", name: "Salloni 1", address: "Rr. Nënë Tereza 1", fiscalBranchNumber: 1, location: "Prishtinë",
  warehouseId: "w1", priceListId: undefined, receiptHeader: undefined, receiptFooter: undefined, isActive: true,
};
const REGISTER = {
  id: "r1", storeId: "s1", storeName: "Salloni 1", code: "K1", name: "Arka 1", profile: 4, fiscalMode: 0, fiscalPosNumber: 1,
  fiscalizationNumber: undefined, cashAccountId: "a1", isActive: true, certificateNotAfter: undefined, openSessionId: "ss1",
};
const SESSION = { id: "ss1", registerId: "r1", registerCode: "K1", number: 1, state: 0, businessDate: "2026-11-02", openedAt: "2026-11-02T08:00:00Z", closedAt: undefined, netSales: 0, journalEntryId: undefined };
const BOOT = {
  register: REGISTER, store: STORE, session: SESSION, cashLimitB2C: 2000, companyName: "Salon Co", fiscalNumber: "811234567", vatNumber: undefined,
  tenders: [{ id: "cash", name: "Arka", kind: 0 }, { id: "gift", name: "Kartelë dhuratë", kind: 4 }],
};
const HAIRCUT = {
  id: "svc1", code: 11, name: "Prerje flokësh", unit: "shërbim", salesUnit: undefined, salesUnitFactor: undefined, barcodes: [], price: 15,
  taxDefinitionId: "t18", taxLetter: "E", taxRate: 0.18, tracksStock: false, trackLots: false, categoryId: undefined,
};
const RESOURCE = {
  id: "res1", storeId: "s1", name: "Arta", kind: 0, userId: "u1", color: "#ff0000", isActive: true,
  hours: [{ day: 0, from: "09:00:00", to: "17:00:00" }], serviceItemIds: ["svc1"],
};
const APPOINTMENT = {
  id: "a1", number: "AP-00001", storeId: "s1", itemId: "svc1", serviceName: "Prerje flokësh", resourceId: "res1", resourceName: "Arta",
  start: "2026-11-02T09:00:00Z", end: "2026-11-02T09:30:00Z", state: 1, source: 0, customerId: undefined, customerName: "Blerta", phone: undefined,
  email: undefined, notes: undefined, depositCardNumber: "AP-00001", deposited: 5, price: 15, posOrderId: undefined,
};

type Body = {
  lines: { itemId?: string; quantity: number; unitPrice: number; packageNumber?: string }[];
  payments?: { paymentMethodId: string; amount: number; tendered?: number }[];
};
const round = (v: number) => Math.round(v * 100) / 100;
// The mock server's pricing (a test fixture, not the browser's): package sessions are paid by the package.
function quote(_c: string, _r: string, body: Body) {
  const total = round(body.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const fromPackages = round(body.lines.filter((l) => l.packageNumber).reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const paid = round((body.payments ?? []).reduce((s, p) => s + (p.tendered ?? p.amount), 0) + fromPackages);
  return Promise.resolve({
    lines: body.lines.map((l) => ({ taxLetter: "E", gross: round(l.quantity * l.unitPrice), net: 0, tax: 0 })), taxes: [], total, totalTax: 0, totalDiscount: 0,
    paid, remaining: Math.max(0, round(total - paid)), change: Math.max(0, round(paid - total)), cashLimitExceeded: false,
  });
}
const lastQuote = () => api.quotePosBasket.mock.lastCall?.[2] as Body;
const recorded = (body: { clientUuid: string }) => ({
  id: "o1", clientUuid: body.clientUuid, number: "K1-00001", kind: 0, state: 0, orderedAt: "2026-11-02T09:40:00Z", operatorName: "Arta",
  customerId: undefined, originalOrderId: undefined, total: 15, totalTax: 0, totalDiscount: 0, change: 0, registerId: "r1",
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

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getPosBootstrap.mockResolvedValue(BOOT);
  api.getPosCatalog.mockResolvedValue([HAIRCUT]);
  api.quotePosBasket.mockImplementation(quote);
  api.submitPosOrder.mockImplementation((_c: string, body: { clientUuid: string }) => Promise.resolve(recorded(body)));
  api.itemsGET.mockResolvedValue({ items: [{ ...HAIRCUT, type: 1, description: undefined, isBookable: true, durationMinutes: 30 }], total: 1, page: 1, pageSize: 200 });
  api.partnersAll.mockResolvedValue([]);
  api.listPosStores.mockResolvedValue([STORE]);
  api.listPosRegisters.mockResolvedValue([REGISTER]);
  api.membersAll.mockResolvedValue([{ membershipId: "m1", userId: "u1", email: "arta@salon.test", role: 3 }]);
  api.listPosResources.mockResolvedValue([RESOURCE]);
});

describe("Booking an appointment (P4)", () => {
  it("offers the server's free starts in Kosovo time and books the one picked", async () => {
    api.getPosAvailability.mockResolvedValue({
      date: "2026-11-02", durationMinutes: 30, resources: [{ resourceId: "res1", name: "Arta", starts: ["2026-11-02T09:00:00Z", "2026-11-02T09:30:00Z"] }],
    });
    api.createPosAppointment.mockImplementation((_c: string, body: object) => Promise.resolve({ ...APPOINTMENT, ...body, id: "a9" }));
    const onSaved = vi.fn();
    renderWith(<BookingDialog storeId="s1" resources={[RESOURCE]} slot={{ date: "2026-11-02", time: "", resourceId: "" }} onClose={() => undefined} onSaved={onSaved} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Service" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Prerje flokësh/ }));

    await waitFor(() => expect(api.getPosAvailability).toHaveBeenCalledWith("c1", "s1", "svc1", "2026-11-02", undefined));
    // 09:00 UTC is 10:00 in Prishtina in November.
    fireEvent.click(await within(dialog).findByRole("button", { name: "Arta at 10:00" }));
    fireEvent.change(within(dialog).getByLabelText("Customer name"), { target: { value: "Blerta" } });
    fireEvent.change(within(dialog).getByLabelText("Phone"), { target: { value: "044 123 456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Book" }));

    await waitFor(() => expect(api.createPosAppointment).toHaveBeenCalled());
    expect(api.createPosAppointment.mock.calls[0][1]).toMatchObject({
      storeId: "s1", itemId: "svc1", resourceId: "res1", start: "2026-11-02T09:00:00.000Z", customerName: "Blerta", phone: "044 123 456",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe("Till — services (P4)", () => {
  it("checks out ?appointment=: its service for whoever performed it, the appointment id and its deposit as a tender", async () => {
    api.listPosAppointments.mockResolvedValue([APPOINTMENT]);
    renderAt("/pos/till/r1?appointment=a1&on=2026-11-02", "/pos/till/:registerId", <Till />);

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "svc1", quantity: 1, unitPrice: 15, staffUserId: "u1" });
    // The day asked for is the appointment's, in Kosovo time.
    expect(api.listPosAppointments).toHaveBeenCalledWith("c1", "s1", "2026-11-01T23:00:00.000Z", "2026-11-02T23:00:00.000Z", undefined);
    expect(screen.getByTestId("checkout-appointment")).toHaveTextContent("AP-00001");

    const payButton = screen.getByRole("button", { name: /Pay/ });
    await waitFor(() => expect(payButton).toBeEnabled());
    fireEvent.click(payButton);
    const pay = await screen.findByRole("dialog");
    const offer = within(pay).getByTestId("offered-tender");
    expect(offer).toHaveTextContent("Card AP-00001: 5.00");
    const use = within(offer).getByRole("button", { name: "Use" });
    await waitFor(() => expect(use).toBeEnabled());
    fireEvent.click(use);
    await waitFor(() => expect(within(pay).queryByTestId("offered-tender")).not.toBeInTheDocument());
    const exact = within(pay).getByRole("button", { name: "Exact amount" });
    await waitFor(() => expect(exact).toBeEnabled());
    fireEvent.click(exact);
    const confirm = within(pay).getByRole("button", { name: "Complete sale" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    const body = api.submitPosOrder.mock.calls[0][1];
    expect(body.appointmentId).toBe("a1");
    expect(body.lines[0]).toMatchObject({ itemId: "svc1", staffUserId: "u1" });
    expect(body.payments[0]).toMatchObject({ paymentMethodId: "gift", amount: 5, reference: "AP-00001" });
    expect(body.payments[1]).toMatchObject({ paymentMethodId: "cash", amount: 10 });
  });

  it("takes a session from a package: the line carries the package number and needs no tender", async () => {
    api.listPosPackages.mockResolvedValue([{
      id: "pk1", number: "PK-00001", serviceItemId: "svc1", serviceName: "Prerje flokësh", holderName: "Blerta", phone: undefined,
      sessionsTotal: 10, sessionsUsed: 3, sessionsLeft: 7, unitValue: 12, expiresOn: undefined, isActive: true,
    }]);
    renderAt("/pos/till/r1", "/pos/till/:registerId", <Till />);
    fireEvent.click(await screen.findByRole("button", { name: "Package" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Package number, holder or phone"), { target: { value: "PK-00001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Find" }));
    expect(await within(dialog).findByText("7 of 10 sessions left · 12.00 per session")).toBeInTheDocument();
    expect(api.listPosPackages).toHaveBeenCalledWith("c1", "PK-00001");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use a session" }));

    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "svc1", quantity: 1, unitPrice: 12, packageNumber: "PK-00001" });
    expect(screen.getByTestId("line-package")).toHaveTextContent("Package PK-00001");

    const payButton = screen.getByRole("button", { name: /Pay/ });
    await waitFor(() => expect(payButton).toBeEnabled());
    fireEvent.click(payButton);
    const pay = await screen.findByRole("dialog");
    const confirm = within(pay).getByRole("button", { name: "Complete sale" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    const body = api.submitPosOrder.mock.calls[0][1];
    expect(body.lines[0]).toMatchObject({ packageNumber: "PK-00001" });
    expect(body.payments).toEqual([]);
  });
});

describe("Repair intake (P4)", () => {
  it("sends the intake with its estimate line (an empty price takes the store's)", async () => {
    api.createPosRepair.mockImplementation((_c: string, body: { customerName: string; device: string; problem: string }) =>
      Promise.resolve({
        id: "rp1", number: "RP-00001", storeId: "s1", state: 0, customerId: undefined, customerName: body.customerName, phone: "044 1", email: undefined,
        device: body.device, serialOrPlate: undefined, problem: body.problem, accessories: "Karikues", technicianUserId: undefined, notes: undefined,
        lines: [{ id: "l1", itemId: "svc1", description: "Prerje flokësh", quantity: 1, unitPrice: 15, amount: 15 }], estimateTotal: 15,
        createdAt: "2026-11-02T09:00:00Z", approvedAt: undefined, readyAt: undefined, collectedOrderId: undefined,
      }),
    );
    renderWith(<RepairDialog ticket={null} onClose={() => undefined} onChanged={() => undefined} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Customer name"), { target: { value: "Driton" } });
    fireEvent.change(within(dialog).getByLabelText("Phone"), { target: { value: "044 1" } });
    fireEvent.change(within(dialog).getByLabelText("Device or vehicle"), { target: { value: "iPhone 13" } });
    fireEvent.change(within(dialog).getByLabelText("Serial / IMEI / plate"), { target: { value: "IMEI-9" } });
    fireEvent.change(within(dialog).getByLabelText("Problem described"), { target: { value: "Ekrani i thyer" } });
    fireEvent.change(within(dialog).getByLabelText("Accessories left"), { target: { value: "Karikues" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add line" }));
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Item" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Prerje flokësh/ }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Take in" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Take in" }));

    await waitFor(() => expect(api.createPosRepair).toHaveBeenCalled());
    expect(api.createPosRepair.mock.calls[0][1]).toMatchObject({
      storeId: "s1", customerName: "Driton", phone: "044 1", device: "iPhone 13", serialOrPlate: "IMEI-9", problem: "Ekrani i thyer",
      accessories: "Karikues", lines: [{ itemId: "svc1", quantity: 1, unitPrice: undefined }],
    });
    // The saved ticket's estimate, as the server worked it out; the flow and the receipt are offered.
    expect(await within(dialog).findByTestId("repair-estimate")).toHaveTextContent("15.00");
    expect(within(dialog).getByRole("button", { name: "Print intake receipt" })).toBeInTheDocument();
  });

  it("loads a repair's estimate into the till for ?repair= and sends the ticket id", async () => {
    api.getPosRepair.mockResolvedValue({
      id: "rp1", number: "RP-00001", storeId: "s1", state: 5, customerId: undefined, customerName: "Driton", phone: undefined, email: undefined,
      device: "iPhone 13", serialOrPlate: undefined, problem: "Ekrani", accessories: undefined, technicianUserId: undefined, notes: undefined,
      lines: [{ id: "l1", itemId: "svc1", description: "Ndërrim ekrani", quantity: 1, unitPrice: 80, amount: 80 }], estimateTotal: 80,
      createdAt: "2026-11-01T09:00:00Z", approvedAt: undefined, readyAt: undefined, collectedOrderId: undefined,
    });
    renderAt("/pos/till/r1?repair=rp1", "/pos/till/:registerId", <Till />);
    await waitFor(() => expect(lastQuote()?.lines).toHaveLength(1));
    expect(lastQuote().lines[0]).toMatchObject({ itemId: "svc1", quantity: 1, unitPrice: 80 });
    expect(screen.getByTestId("collecting-repair")).toHaveTextContent("RP-00001");

    const payButton = screen.getByRole("button", { name: /Pay/ });
    await waitFor(() => expect(payButton).toBeEnabled());
    fireEvent.click(payButton);
    const pay = await screen.findByRole("dialog");
    const exact = within(pay).getByRole("button", { name: "Exact amount" });
    await waitFor(() => expect(exact).toBeEnabled());
    fireEvent.click(exact);
    const confirm = within(pay).getByRole("button", { name: "Complete sale" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(api.submitPosOrder).toHaveBeenCalled());
    expect(api.submitPosOrder.mock.calls[0][1].repairTicketId).toBe("rp1");
  });
});

describe("Online booking (P4)", () => {
  it("books through the store's link: service, time, name and phone, then the confirmation", async () => {
    api.getPublicBooking.mockResolvedValue({
      storeName: "Salloni 1", address: "Rr. Nënë Tereza 1",
      services: [{ itemId: "svc1", name: "Prerje flokësh", description: undefined, durationMinutes: 30, price: 15, resources: [{ id: "res1", name: "Arta" }] }],
    });
    api.getPublicAvailability.mockResolvedValue({ date: "2026-11-02", durationMinutes: 30, resources: [{ resourceId: "res1", name: "Arta", starts: ["2026-11-02T09:00:00Z"] }] });
    api.bookPublicAppointment.mockResolvedValue({ number: "AP-00007", start: "2026-11-02T09:00:00Z", end: "2026-11-02T09:30:00Z", resourceName: "Arta" });
    renderAt("/book/tok1", "/book/:token", <PublicBooking />);

    fireEvent.click(await screen.findByRole("button", { name: /Prerje flokësh/ }));
    await waitFor(() => expect(api.getPublicAvailability).toHaveBeenCalled());
    expect(api.getPublicAvailability.mock.calls[0][0]).toBe("tok1");
    expect(api.getPublicAvailability.mock.calls[0][1]).toBe("svc1");
    fireEvent.click(await screen.findByRole("button", { name: "10:00" }));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Blerta" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "044 555 666" } });
    fireEvent.click(screen.getByRole("button", { name: "Book" }));

    await waitFor(() => expect(api.bookPublicAppointment).toHaveBeenCalled());
    expect(api.bookPublicAppointment.mock.calls[0]).toEqual([
      "tok1",
      { itemId: "svc1", start: "2026-11-02T09:00:00Z", name: "Blerta", phone: "044 555 666", resourceId: undefined, email: undefined, notes: undefined },
    ]);
    const done = await screen.findByTestId("booked");
    expect(done).toHaveTextContent("AP-00007");
    expect(done).toHaveTextContent("With Arta");
  });
});
