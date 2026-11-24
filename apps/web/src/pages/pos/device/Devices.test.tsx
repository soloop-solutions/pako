import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeviceGuard } from "@/components/DeviceGuard";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { DeviceConnect } from "@/pages/pos/device/DeviceConnect";
import { DeviceHome } from "@/pages/pos/device/DeviceHome";
import { PosDevicesCard } from "@/pages/pos/device/PosDevices";

// docs/POS_TILL_ACCESS.md §7 (user request 2026-11-24): till and kitchen screens sign in as devices.
const api = vi.hoisted(() => ({
  getMyAccount: vi.fn(),
  listPosDevices: vi.fn(),
  createPosDevice: vi.fn(),
  createPosDeviceLink: vi.fn(),
  disconnectPosDevice: vi.fn(),
  renamePosDevice: vi.fn(),
  listPosRegisters: vi.fn(),
  listPosStores: vi.fn(),
  getPosMenu: vi.fn(),
  posPinSignIn: vi.fn(),
  disconnectThisPosDevice: vi.fn(),
}));
const auth = vi.hoisted(() => ({ connectDevice: vi.fn(), logout: vi.fn() }));
const company = vi.hoisted(() => ({ activeCompanyId: "c1" as string | null, setActiveCompanyId: vi.fn() }));

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
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { userId: "d1" }, ...auth }),
  useOptionalAuth: () => ({ auth: { userId: "d1" }, ...auth }),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ ...company, activeCompany: { id: "c1", name: "Te Ura" } }),
}));
vi.mock("@/hooks/useFeatures", () => ({ useFeatures: () => ({ hasFeature: () => true, features: [], isLoading: false, businessType: null }) }));

function renderAt(url: string, routes: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>{routes}</Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

const guarded = (
  <Route element={<DeviceGuard />}>
    <Route path="/device" element={<p>device home</p>} />
    <Route path="/pos/till/:id" element={<p>the till</p>} />
    <Route path="/ledger" element={<p>the ledger</p>} />
  </Route>
);

describe("Till devices", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    Object.values(auth).forEach((f) => f.mockReset());
    company.setActiveCompanyId.mockReset();
    company.activeCompanyId = "c1";
    localStorage.clear();
  });

  it("keeps a device on its till and kitchen screens: any other page leads back to the device home", async () => {
    api.getMyAccount.mockResolvedValue({ userId: "d1", email: "till@devices.pako.invalid", posDeviceCompanyId: "c1", posDeviceName: "Bar till" });
    renderAt("/ledger", guarded);
    expect(await screen.findByText("device home")).toBeInTheDocument();
    expect(screen.queryByText("the ledger")).not.toBeInTheDocument();
  });

  it("lets a device open its till, and switches it to its own company", async () => {
    company.activeCompanyId = "other";
    api.getMyAccount.mockResolvedValue({ userId: "d1", email: "till@devices.pako.invalid", posDeviceCompanyId: "c1", posDeviceName: "Bar till" });
    renderAt("/pos/till/r1", guarded);
    await waitFor(() => expect(company.setActiveCompanyId).toHaveBeenCalledWith("c1"));
    company.activeCompanyId = "c1";
  });

  it("leaves a person's pages alone", async () => {
    api.getMyAccount.mockResolvedValue({ userId: "u1", email: "owner@pako.test" });
    renderAt("/ledger", guarded);
    expect(await screen.findByText("the ledger")).toBeInTheDocument();
  });

  it("connects with the link once and opens the device home", async () => {
    auth.connectDevice.mockResolvedValue(undefined);
    renderAt("/device/connect?code=abc123", <>
      <Route path="/device/connect" element={<DeviceConnect />} />
      <Route path="/device" element={<p>device home</p>} />
    </>);
    expect(await screen.findByText("device home")).toBeInTheDocument();
    expect(auth.connectDevice).toHaveBeenCalledTimes(1);
    expect(auth.connectDevice).toHaveBeenCalledWith("abc123");
  });

  it("says so when the link is used or expired", async () => {
    auth.connectDevice.mockRejectedValue(new Error("used"));
    renderAt("/device/connect?code=old", <Route path="/device/connect" element={<DeviceConnect />} />);
    expect(await screen.findByText(/could not be connected|used/)).toBeInTheDocument();
  });

  it("without a link, connects with the short code typed on the till PC", async () => {
    auth.connectDevice.mockRejectedValueOnce(new Error("This connect link is not valid any more")).mockResolvedValueOnce(undefined);
    renderAt("/device/connect", <>
      <Route path="/device/connect" element={<DeviceConnect />} />
      <Route path="/device" element={<p>device home</p>} />
    </>);
    const field = await screen.findByLabelText("Connect code");
    const submit = screen.getByRole("button", { name: "Connect" });
    fireEvent.change(field, { target: { value: "k7m4-qp2" } });
    expect(submit).toBeDisabled();

    fireEvent.change(field, { target: { value: "k7m4-qp2x" } });
    fireEvent.click(submit);
    expect(await screen.findByText(/not valid any more/)).toBeInTheDocument();
    expect(auth.connectDevice).toHaveBeenCalledWith("K7M4QP2X");

    fireEvent.change(screen.getByLabelText("Connect code"), { target: { value: "K7M4 QP2Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("device home")).toBeInTheDocument();
    expect(auth.connectDevice).toHaveBeenLastCalledWith("K7M4QP2Y");
  });

  it("shows the device its tills and kitchen screens and remembers the one opened", async () => {
    api.getMyAccount.mockResolvedValue({ userId: "d1", email: "x", posDeviceCompanyId: "c1", posDeviceName: "Bar till" });
    api.listPosRegisters.mockResolvedValue([{ id: "r1", name: "Bar", code: "R1", isActive: true }]);
    api.listPosStores.mockResolvedValue([{ id: "s1", name: "Te Ura", isActive: true }]);
    api.getPosMenu.mockResolvedValue({ centers: [{ id: "k1", name: "Kuzhina", isActive: true, storeId: null }] });
    api.posPinSignIn.mockResolvedValue({ userId: "m1", name: "Manager", token: "op", expiresAt: "2099-01-01T00:00:00Z" });
    api.disconnectThisPosDevice.mockResolvedValue(undefined);
    renderAt("/device", <>
      <Route path="/device" element={<DeviceHome />} />
      <Route path="/pos/till/:id" element={<p>the till</p>} />
      <Route path="/login" element={<p>login</p>} />
    </>);
    await waitFor(() => expect(screen.getByTestId("device-name")).toHaveTextContent("Bar till"));
    expect(await screen.findByText("Kuzhina · Te Ura")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("Bar"));
    expect(await screen.findByText("the till")).toBeInTheDocument();
    expect(localStorage.getItem("pako.device.lastScreen")).toBe("/pos/till/r1");
  });

  it("disconnects only with a manager PIN, then signs the device out", async () => {
    api.getMyAccount.mockResolvedValue({ userId: "d1", email: "x", posDeviceCompanyId: "c1", posDeviceName: "Bar till" });
    api.listPosRegisters.mockResolvedValue([]);
    api.listPosStores.mockResolvedValue([]);
    api.getPosMenu.mockResolvedValue({ centers: [] });
    api.posPinSignIn.mockResolvedValue({ userId: "m1", name: "Manager", token: "op", expiresAt: "2099-01-01T00:00:00Z" });
    api.disconnectThisPosDevice.mockResolvedValue(undefined);
    renderAt("/device", <>
      <Route path="/device" element={<DeviceHome />} />
      <Route path="/login" element={<p>login</p>} />
    </>);
    fireEvent.click(await screen.findByRole("button", { name: /Disconnect device/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Manager PIN"), { target: { value: "7291" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect device" }));
    expect(await screen.findByText("login")).toBeInTheDocument();
    expect(api.posPinSignIn).toHaveBeenCalledWith("c1", { pin: "7291" });
    expect(api.disconnectThisPosDevice).toHaveBeenCalledWith("c1");
    expect(auth.logout).toHaveBeenCalled();
  });

  it("lets the administrator add a device and shows its one-use connect link", async () => {
    api.listPosDevices.mockResolvedValue([]);
    api.createPosDevice.mockResolvedValue({ deviceId: "d1", name: "Bar till", code: "CODE-1", expiresAt: "2026-11-25T12:00:00Z", pairCode: "K7M4-QP2X" });
    renderAt("/pos/setup", <Route path="/pos/setup" element={<PosDevicesCard />} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add device/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bar till" } });
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    const link = await screen.findByTestId("device-link");
    expect(api.createPosDevice).toHaveBeenCalledWith("c1", { name: "Bar till" });
    expect(within(link).getByTestId("device-pair-code")).toHaveTextContent("K7M4-QP2X");
    expect((within(link).getByLabelText("Connect address") as HTMLInputElement).value).toBe(`${window.location.origin}/device/connect?code=CODE-1`);
  });

  it("in the desktop app, links use this PC's address on the shop network", async () => {
    const desktop = {
      isDesktop: true,
      version: "1.0.0",
      ...Object.fromEntries(["backupNow", "listBackups", "restoreFromFile", "chooseBackupDir", "getBackupSettings", "openLogFolder"].map((m) => [m, vi.fn()])),
      getTillNetwork: vi.fn(),
      setTillNetwork: vi.fn(),
    };
    (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = desktop;
    try {
      api.listPosDevices.mockResolvedValue([]);
      api.createPosDevice.mockResolvedValue({ deviceId: "d1", name: "Bar till", code: "CODE-1", expiresAt: "2026-11-25T12:00:00Z" });

      // Tills off: no 127.0.0.1 link a tablet couldn't open, but the way to turn them on.
      desktop.getTillNetwork.mockResolvedValue({ enabled: false, port: 5300, running: false, urls: [], error: null });
      const off = renderAt("/pos/setup", <Route path="/pos/setup" element={<PosDevicesCard />} />);
      fireEvent.click(await screen.findByRole("button", { name: /Add device/ }));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bar till" } });
      fireEvent.click(screen.getByRole("button", { name: "Create link" }));
      const notice = await screen.findByTestId("device-link-off");
      expect(await within(notice).findByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings#tills");
      expect(screen.queryByTestId("device-link")).toBeNull();
      off.unmount();

      desktop.getTillNetwork.mockResolvedValue({ enabled: true, port: 5300, running: true, urls: ["http://192.168.1.10:5300"], error: null });
      renderAt("/pos/setup", <Route path="/pos/setup" element={<PosDevicesCard />} />);
      fireEvent.click(await screen.findByRole("button", { name: /Add device/ }));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bar till" } });
      fireEvent.click(screen.getByRole("button", { name: "Create link" }));
      const link = await screen.findByTestId("device-link");
      expect((within(link).getByLabelText("Connect address") as HTMLInputElement).value).toBe("http://192.168.1.10:5300/device/connect?code=CODE-1");
    } finally {
      delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
    }
  });

  it("lists devices with their state and disconnects one after confirming", async () => {
    api.listPosDevices.mockResolvedValue([
      { id: "d1", name: "Bar till", active: true, connected: true, createdAt: "2026-11-24T08:00:00Z", lastSeenAt: "2026-11-24T10:00:00Z" },
      { id: "d2", name: "Kitchen", active: false, connected: false, createdAt: "2026-11-24T08:00:00Z" },
    ]);
    api.disconnectPosDevice.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAt("/pos/setup", <Route path="/pos/setup" element={<PosDevicesCard />} />);
    const row = (await screen.findByText("Bar till")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /Disconnect/ }));
    await waitFor(() => expect(api.disconnectPosDevice).toHaveBeenCalledWith("c1", "d1"));
    confirmSpy.mockRestore();
  });
});
