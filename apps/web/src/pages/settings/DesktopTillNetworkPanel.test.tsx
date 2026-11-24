import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { DesktopTillNetworkPanel } from "@/pages/settings/DesktopTillNetworkPanel";

const off = { enabled: false, port: 5300, running: false, urls: [], error: null };
const on = { enabled: true, port: 5300, running: true, urls: ["http://192.168.1.10:5300", "http://10.0.0.5:5300"], error: null };

const bridge = {
  isDesktop: true as const,
  version: "1.0.0",
  backupNow: vi.fn(),
  listBackups: vi.fn(),
  restoreFromFile: vi.fn(),
  chooseBackupDir: vi.fn(),
  getBackupSettings: vi.fn(),
  openLogFolder: vi.fn(),
  getTillNetwork: vi.fn(),
  setTillNetwork: vi.fn(),
};

function renderPanel(canManage = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <IntlProviderWrapper>
      <QueryClientProvider client={queryClient}>
        <DesktopTillNetworkPanel canManage={canManage} />
      </QueryClientProvider>
    </IntlProviderWrapper>,
  );
}

describe("DesktopTillNetworkPanel", () => {
  beforeEach(() => {
    Object.values(bridge).forEach((f) => typeof f === "function" && f.mockReset());
    (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = bridge;
  });
  afterEach(() => {
    delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
  });

  it("is not shown in the browser or in a desktop build without till support", () => {
    delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
    const older: Record<string, unknown> = { ...bridge };
    delete older.getTillNetwork;
    delete older.setTillNetwork;
    (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = older;
    expect(renderPanel().container).toBeEmptyDOMElement();
  });

  it("turns tills on with the port and shows where tablets open PAKO", async () => {
    bridge.getTillNetwork.mockResolvedValue(off);
    bridge.setTillNetwork.mockResolvedValue({ ok: true, status: { ...on, port: 5400, urls: ["http://192.168.1.10:5400"] } });
    renderPanel();

    fireEvent.click(await screen.findByLabelText("Allow tills on this network"));
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "5400" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(bridge.setTillNetwork).toHaveBeenCalledWith({ enabled: true, port: 5400 }));
    expect(await screen.findByText("http://192.168.1.10:5400")).toBeInTheDocument();
    expect(screen.getByText(/Windows asks to let PAKO through the firewall/)).toBeInTheDocument();
  });

  it("says why it could not turn them on", async () => {
    bridge.getTillNetwork.mockResolvedValue(off);
    bridge.setTillNetwork.mockResolvedValue({ ok: false, error: "Port 5300 is used by another program on this PC. Choose another port for the tills." });
    renderPanel();

    fireEvent.click(await screen.findByLabelText("Allow tills on this network"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText(/Port 5300 is used by another program/)).toBeInTheDocument();
  });

  it("refuses a port out of range", async () => {
    bridge.getTillNetwork.mockResolvedValue(off);
    renderPanel();

    fireEvent.click(await screen.findByLabelText("Allow tills on this network"));
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "80" } });

    expect(screen.getByText("Choose a port between 1024 and 65535.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("shows the addresses, read-only without settings rights", async () => {
    bridge.getTillNetwork.mockResolvedValue(on);
    renderPanel(false);

    expect(await screen.findByText("http://10.0.0.5:5300")).toBeInTheDocument();
    expect(screen.getByLabelText("Allow tills on this network")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });
});
