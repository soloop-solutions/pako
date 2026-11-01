import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { MyRouteDay } from "@/pages/distribution/MyRouteDay";
import { RouteVisits } from "@/pages/distribution/RouteVisits";
import { SalesRoutes } from "@/pages/distribution/SalesRoutes";
import { VanLoad, VanSettlement } from "@/pages/distribution/VanSales";

// docs/POS_PLAN.md P6 — routes, the salesperson's day, visits and van sales against a mocked client.
const api = vi.hoisted(() => ({
  getMyRouteDay: vi.fn(),
  checkInRouteVisit: vi.fn(),
  updateRouteVisit: vi.fn(),
  listRouteVisits: vi.fn(),
  listSalesRoutes: vi.fn(),
  createSalesRoute: vi.fn(),
  membersAll: vi.fn(),
  partnersAll: vi.fn(),
  listWarehouses: vi.fn(),
  getVanLoad: vi.fn(),
  getVanSettlement: vi.fn(),
  createStockDocument: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  const mocked = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]));
  return { ...actual, apiClient: { ...actual.apiClient, ...mocked } };
});

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1", activeCompany: { id: "c1", name: "Pako Distribution" } }) }));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const MAIN = { id: "wh1", code: "MAIN", name: "Main", address: undefined, isActive: true, isDefault: true, isVan: false };
const VAN = { id: "van1", code: "VAN1", name: "Van Prizren", address: undefined, isActive: true, isDefault: false, isVan: true, driverUserId: "u1" };

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

const STOP = { partnerId: "p1", partnerName: "Market Arbeni", sequence: 1, notes: "Back door", visitId: undefined, outcome: undefined, outstanding: 320.5, overdue: 120, blocked: true };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.membersAll.mockResolvedValue([{ membershipId: "m1", userId: "u1", email: "driton@pako.test", role: 3 }]);
  api.partnersAll.mockResolvedValue([
    { id: "p1", name: "Market Arbeni", isCustomer: true, isVendor: false },
    { id: "p2", name: "Viva Fresh", isCustomer: true, isVendor: false },
  ]);
  api.listWarehouses.mockResolvedValue([MAIN, VAN]);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "geolocation");
});

describe("My day (P6)", () => {
  it("checks in with the device's position and then records the outcome", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 42.2139, longitude: 20.7397, accuracy: 12 } } as GeolocationPosition) },
    });
    api.getMyRouteDay
      .mockResolvedValueOnce([{ routeId: "r1", name: "Prizren Monday", warehouseId: "van1", date: "2026-11-02", stops: [STOP] }])
      .mockResolvedValue([{ routeId: "r1", name: "Prizren Monday", warehouseId: "van1", date: "2026-11-02", stops: [{ ...STOP, visitId: "v1", outcome: 0 }] }]);
    api.checkInRouteVisit.mockResolvedValue({ id: "v1", latitude: 42.2139 });
    api.updateRouteVisit.mockResolvedValue({ id: "v1" });
    renderAt("/distribution/my-day?date=2026-11-02", <MyRouteDay />);

    const card = await screen.findByRole("article", { name: "Market Arbeni" });
    expect(within(card).getByText("Blocked: overdue")).toBeInTheDocument();
    expect(within(card).getByText("Overdue 120.00")).toBeInTheDocument();
    expect(api.getMyRouteDay).toHaveBeenCalledWith("c1", "2026-11-02");
    fireEvent.click(within(card).getByRole("button", { name: "Check in" }));

    await waitFor(() => expect(api.checkInRouteVisit).toHaveBeenCalledWith("c1", {
      partnerId: "p1", routeId: "r1", latitude: 42.2139, longitude: 20.7397, accuracyMeters: 12,
    }));
    const checkedIn = await screen.findByRole("article", { name: "Market Arbeni" });
    fireEvent.click(await within(checkedIn).findByRole("radio", { name: "Collection" }));
    fireEvent.change(within(checkedIn).getByLabelText("Cash collected"), { target: { value: "50" } });
    fireEvent.click(within(checkedIn).getByRole("button", { name: "Save and check out" }));
    await waitFor(() => expect(api.updateRouteVisit).toHaveBeenCalledWith("c1", "v1", { outcome: 3, collected: 50, notes: undefined, checkOut: true }));
  });

  it("still checks in when the device has no position", async () => {
    api.getMyRouteDay.mockResolvedValue([{ routeId: "r1", name: "Prizren Monday", warehouseId: undefined, date: "2026-11-02", stops: [STOP] }]);
    api.checkInRouteVisit.mockResolvedValue({ id: "v1", latitude: undefined });
    renderAt("/distribution/my-day", <MyRouteDay />);
    fireEvent.click(await screen.findByRole("button", { name: "Check in" }));
    await waitFor(() => expect(api.checkInRouteVisit).toHaveBeenCalledWith("c1", {
      partnerId: "p1", routeId: "r1", latitude: undefined, longitude: undefined, accuracyMeters: undefined,
    }));
    expect(await screen.findByText(/without a position/)).toBeInTheDocument();
  });
});

describe("Sales routes (P6)", () => {
  it("saves the days as a bitmask and the stops in order", async () => {
    api.listSalesRoutes.mockResolvedValue([]);
    api.createSalesRoute.mockResolvedValue({ id: "r1" });
    renderAt("/distribution/routes", <SalesRoutes />);
    fireEvent.click(await screen.findByRole("button", { name: /New route/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Route"), { target: { value: "Prizren" } });
    fireEvent.click(within(dialog).getByLabelText("Monday"));
    fireEvent.click(within(dialog).getByLabelText("Thursday"));
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Add a customer…" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Market Arbeni/ }));
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Add a customer…" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Viva Fresh/ }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Move up" })[1]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.createSalesRoute).toHaveBeenCalled());
    expect(api.createSalesRoute.mock.calls[0][1]).toMatchObject({
      name: "Prizren", days: 1 | 8, stops: [{ partnerId: "p2" }, { partnerId: "p1" }],
    });
  });
});

describe("Visits (P6)", () => {
  it("shows the API's KPIs and a map link per visit", async () => {
    api.listRouteVisits.mockResolvedValue({
      visits: 4, withOrder: 3, strikeRate: 0.75, orderValue: 900, dropSize: 300, collected: 150,
      items: [{
        id: "v1", routeId: "r1", partnerId: "p1", partnerName: "Market Arbeni", userId: "u1", date: "2026-11-02", checkInAt: "2026-11-02T08:15:00Z",
        checkOutAt: undefined, latitude: 42.2139, longitude: 20.7397, accuracyMeters: 12, outcome: 1, collected: 0, notes: undefined, salesOrderIds: ["so1"],
      }],
    });
    renderAt("/distribution/visits?date=2026-11-02&member=u1", <RouteVisits />);
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("300.00")).toBeInTheDocument();
    expect(api.listRouteVisits).toHaveBeenCalledWith("c1", "2026-11-02", "u1");
    expect(screen.getByRole("link", { name: /Map/ })).toHaveAttribute("href", "https://www.google.com/maps?q=42.2139,20.7397");
  });
});

describe("Van sales (P6)", () => {
  it("drafts the morning transfer from the main warehouse to the van for what is still to load", async () => {
    api.getVanLoad.mockResolvedValue([
      { itemId: "i1", itemCode: 101, itemName: "Ujë 0.5L", unit: "copë", ordered: 120, onVan: 20, toLoad: 100 },
      { itemId: "i2", itemCode: 102, itemName: "Lëng molle", unit: "copë", ordered: 10, onVan: 30, toLoad: 0 },
    ]);
    api.createStockDocument.mockResolvedValue({ id: "sd1" });
    renderAt("/distribution/van-load?van=van1&date=2026-11-02", <VanLoad />);
    expect(await screen.findByText("Lëng molle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Create transfer/ }));
    await waitFor(() => expect(api.createStockDocument).toHaveBeenCalled());
    expect(api.createStockDocument.mock.calls[0][1]).toMatchObject({
      type: 1, date: "2026-11-02", warehouseId: "wh1", destinationWarehouseId: "van1", lines: [{ itemId: "i1", quantity: 100 }],
    });
  });

  it("renders the settlement per item and the day's money as returned", async () => {
    api.getVanSettlement.mockResolvedValue({
      warehouseId: "van1", warehouseName: "Van Prizren", date: "2026-11-02", invoices: 3, invoiced: 812.4, coupons: 5, couponSales: 64.5, collected: 230, visits: 9,
      lines: [
        { itemId: "i1", itemCode: 101, itemName: "Ujë 0.5L", unit: "copë", opening: 20, loaded: 100, sold: 90, returned: 2, unloaded: 10, other: 0, closing: 22 },
        { itemId: "i2", itemCode: 102, itemName: "Lëng molle", unit: "copë", opening: 30, loaded: 0, sold: 12, returned: 0, unloaded: 0, other: -1, closing: 17 },
      ],
    });
    renderAt("/distribution/van-settlement?van=van1&date=2026-11-02", <VanSettlement />);
    expect(await screen.findAllByText("Ujë 0.5L")).not.toHaveLength(0);
    expect(api.getVanSettlement).toHaveBeenCalledWith("c1", "van1", "2026-11-02");
    const row = screen.getAllByRole("row").find((r) => within(r).queryByText("Lëng molle") && within(r).queryByText("17"));
    expect(row).toBeDefined();
    expect(screen.getAllByText("812.40").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 invoices").length).toBeGreaterThan(0);
    expect(screen.getAllByText("230.00").length).toBeGreaterThan(0);
  });
});
