import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Kds } from "@/pages/pos/Kds";

// docs/POS_PLAN.md P3 — the kitchen display against a mocked client and SignalR hub.
const api = vi.hoisted(() => ({
  listPosStores: vi.fn(),
  getPosMenu: vi.fn(),
  listKitchenTickets: vi.fn(),
  setKitchenTicketState: vi.fn(),
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

const hub = vi.hoisted(() => ({ handlers: {} as Record<string, () => void>, invoke: vi.fn(() => Promise.resolve()) }));
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

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1" }),
}));

const ticket = (over: Record<string, unknown>) => ({
  id: "k1", tabId: "tab1", productionCenterId: "pc1", productionCenterName: "Kuzhina", number: 12, isStorno: false, state: 0,
  tabLabel: "T2", waiterName: "Arta", createdAt: new Date(Date.now() - 7 * 60_000).toISOString(),
  startedAt: undefined, readyAt: undefined, doneAt: undefined,
  lines: [{ tabLineId: "l1", description: "Burger", quantity: 2, modifiers: "Rare", note: "pa qepë", seat: 1, course: 1 }],
  ...over,
});

function renderKds(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/pos/kds" element={<Kds />} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Kitchen display", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    hub.invoke.mockClear();
    api.listPosStores.mockResolvedValue([{ id: "s1", code: "PR1", name: "Restorant", isActive: true }]);
    api.getPosMenu.mockResolvedValue({ modifierGroups: [], combos: {}, productionCenters: {}, centers: [{ id: "pc1", storeId: "s1", name: "Kuzhina", kind: 0, printerName: undefined, isActive: true }] });
  });

  it("shows tickets by stage with their age, highlights a STORNO, and advances a ticket on tap", async () => {
    let tickets = [ticket({}), ticket({ id: "k2", number: 13, isStorno: true, state: 1, tabLabel: "T5" })];
    api.listKitchenTickets.mockImplementation(() => Promise.resolve(tickets));
    api.setKitchenTicketState.mockImplementation((_c: string, id: string, body: { state: number }) => {
      tickets = tickets.map((x) => (x.id === id ? { ...x, state: body.state } : x));
      return Promise.resolve();
    });
    renderKds("/pos/kds?store=s1&center=pc1");

    const fresh = await within(screen.getByTestId("kds-new")).findByTestId("kds-ticket");
    expect(api.listKitchenTickets).toHaveBeenCalledWith("c1", "s1", "pc1", false);
    expect(fresh).toHaveTextContent("#12");
    expect(fresh).toHaveTextContent("7 min");
    expect(fresh).toHaveTextContent("Rare");
    expect(fresh).toHaveTextContent("pa qepë");
    expect(within(screen.getByTestId("kds-inProgress")).getByText("STORNO")).toBeInTheDocument();
    await waitFor(() => expect(hub.invoke).toHaveBeenCalledWith("JoinStore", "c1", "s1"));

    fireEvent.click(fresh);
    await waitFor(() => expect(api.setKitchenTicketState).toHaveBeenCalledWith("c1", "k1", { state: 1 }));
    await waitFor(() => expect(within(screen.getByTestId("kds-new")).queryByTestId("kds-ticket")).toBeNull());
    expect(within(screen.getByTestId("kds-inProgress")).getAllByTestId("kds-ticket")).toHaveLength(2);

    // A "tickets" event from the hub reads the list again.
    const calls = api.listKitchenTickets.mock.calls.length;
    hub.handlers.tickets();
    await waitFor(() => expect(api.listKitchenTickets.mock.calls.length).toBeGreaterThan(calls));
  });
});
