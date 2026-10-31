import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Vendors } from "@/pages/partners/Vendors";

const partnersAll = vi.fn();
const accountsAll = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      partnersAll: (...args: unknown[]) => partnersAll(...args),
      accountsAll: (...args: unknown[]) => accountsAll(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

const VENDOR = {
  id: "partner-2",
  name: "Vendor LLC",
  taxNumber: "222222222",
  isCustomer: false,
  isVendor: true,
  isVatRegistered: false,
  paymentTermDays: 15,
};

const CUSTOMER = {
  id: "partner-1",
  name: "Customer SH",
  taxNumber: "111111111",
  isCustomer: true,
  isVendor: false,
  isVatRegistered: false,
  paymentTermDays: 30,
};

function Probe() {
  return <div data-testid="location">{useLocation().search}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Vendors />
          <Probe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("partner list ?open=", () => {
  beforeEach(() => {
    partnersAll.mockReset().mockResolvedValue([VENDOR]);
    accountsAll.mockReset().mockResolvedValue([]);
  });

  it("opens the editor for the id and clears the param on close", async () => {
    renderAt("/vendors?open=partner-2");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Vendor LLC");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("location").textContent).toBe("");
  });

  it("opens a partner that is not a vendor", async () => {
    partnersAll.mockResolvedValue([VENDOR, CUSTOMER]);
    renderAt("/vendors?open=partner-1");
    expect(await screen.findByRole("dialog")).toHaveTextContent("Customer SH");
  });

  it("ignores an unknown id", async () => {
    renderAt("/vendors?open=nope");
    expect(await screen.findByText("Vendor LLC")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
