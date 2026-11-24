import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { StaffPinsCard } from "@/pages/pos/StaffPins";

// User request 2026-11-24: the administrator generates or types staff till PINs.
const api = vi.hoisted(() => ({
  listPosStaffPins: vi.fn(),
  setPosStaffPin: vi.fn(),
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
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1" }) }));

const LEUTRIM = { operatorId: "u1", name: "Leutrim Bytyqi", email: "restaurant.waiter@pako.test", hasLogin: true, hasPin: false };
const EDONA = { operatorId: "u2", name: "Edona Rexhepi", email: "restaurant.waiter2@pako.test", hasLogin: true, hasPin: false };
const OWNER = { operatorId: "u3", name: "restaurant.owner", email: "restaurant.owner@pako.test", hasLogin: true, hasPin: true };
// An employee with no login: the till knows them by their employee record.
const COOK = { operatorId: "e1", name: "Burim Zeka", email: undefined, hasLogin: false, hasPin: false };

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <StaffPinsCard />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Staff PINs", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listPosStaffPins.mockResolvedValue([COOK, EDONA, LEUTRIM, OWNER]);
  });

  it("generates PINs for everyone without one and shows them once", async () => {
    api.setPosStaffPin.mockImplementation((_c: string, userId: string) =>
      Promise.resolve({ operatorId: userId, name: { u1: LEUTRIM.name, u2: EDONA.name, e1: COOK.name }[userId], pin: { u1: "4821", u2: "7390", e1: "6052" }[userId] }),
    );
    renderCard();

    expect(await screen.findByText("Till only (no login)")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Generate for 3 without a PIN/ }));

    const issued = await screen.findByTestId("issued-pins");
    expect(within(issued).getByText("4821")).toBeInTheDocument();
    expect(within(issued).getByText("7390")).toBeInTheDocument();
    expect(within(issued).getByText("6052")).toBeInTheDocument();
    // Only the three without a PIN (the cook included); the server picks each PIN.
    expect(api.setPosStaffPin).toHaveBeenCalledTimes(3);
    expect(api.setPosStaffPin).toHaveBeenCalledWith("c1", "e1", {});
    expect(api.setPosStaffPin).toHaveBeenCalledWith("c1", "u2", {});
    expect(api.setPosStaffPin).toHaveBeenCalledWith("c1", "u1", {});
  });

  it("lets the administrator type a PIN for one person", async () => {
    api.setPosStaffPin.mockResolvedValue({ operatorId: "u1", name: LEUTRIM.name, pin: "580214" });
    renderCard();

    const row = (await screen.findByText("Leutrim Bytyqi")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Set PIN/ }));
    fireEvent.change(screen.getByLabelText("New PIN"), { target: { value: "580214" } });
    fireEvent.change(screen.getByLabelText("New PIN again"), { target: { value: "580214" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.setPosStaffPin).toHaveBeenCalledWith("c1", "u1", { pin: "580214" }));
    expect(within(await screen.findByTestId("issued-pins")).getByText("580214")).toBeInTheDocument();
  });
});
