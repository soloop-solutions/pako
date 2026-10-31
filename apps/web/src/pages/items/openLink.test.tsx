import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

import { Items } from "./Items";

const m = vi.hoisted(() => ({
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
  taxes: vi.fn(),
  accountsAll: vi.fn(),
  listItemCategories: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ canSee: () => false, canApprove: () => true }),
}));

function item(id: string, name: string) {
  return { id, name, itemType: 0, trackInventory: false, isActive: true, unitPrice: 1, barcodes: [] };
}

function Probe() {
  return <div data-testid="location">{useLocation().search}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Items />
          <Probe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("items ?open=", () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.itemsGET.mockResolvedValue({ items: [item("i1", "On Page")], total: 1, page: 1, pageSize: 50 });
    m.taxes.mockResolvedValue([]);
    m.accountsAll.mockResolvedValue([]);
    m.listItemCategories.mockResolvedValue([]);
  });

  it("opens an item from the loaded page without a single fetch and clears the param on close", async () => {
    renderAt("/items?open=i1");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Edit On Page");
    expect(m.itemsGET2).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("location").textContent).toBe("");
  });

  it("fetches the single item when it is not on the page", async () => {
    m.itemsGET2.mockResolvedValue(item("i9", "Off Page"));
    renderAt("/items?open=i9");
    expect(await screen.findByRole("dialog")).toHaveTextContent("Edit Off Page");
    expect(m.itemsGET2).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", "i9");
  });

  it("leaves the page working when the id does not exist", async () => {
    m.itemsGET2.mockRejectedValue(new Error("404"));
    renderAt("/items?open=nope");
    expect(await screen.findByText("On Page")).toBeInTheDocument();
    await waitFor(() => expect(m.itemsGET2).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
