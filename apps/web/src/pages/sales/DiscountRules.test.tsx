import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { DiscountRules } from "@/pages/sales/DiscountRules";

const api = vi.hoisted(() => ({
  listDiscountRules: vi.fn(),
  createDiscountRule: vi.fn(),
  updateDiscountRule: vi.fn(),
  deleteDiscountRule: vi.fn(),
  partnersAll: vi.fn(),
  listItemCategories: vi.fn(),
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  const mocked = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]));
  return { ...actual, apiClient: { ...actual.apiClient, ...mocked } };
});
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1" }) }));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const RULE = {
  id: "r1", name: "Pije verore", partnerId: "p1", partnerName: "Market Arbeni", itemCategoryId: "cat1", itemCategoryName: "Pije",
  itemId: undefined, itemName: undefined, percent: 7.5, validFrom: "2026-06-01", validTo: "2099-08-31", priority: 0, isActive: true,
};

function renderPage(path = "/discount-rules") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <DiscountRules />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listDiscountRules.mockResolvedValue([RULE]);
  api.partnersAll.mockResolvedValue([{ id: "p1", name: "Market Arbeni", isCustomer: true }, { id: "s1", name: "Furnitori", isCustomer: false }]);
  api.listItemCategories.mockResolvedValue([{ id: "cat1", name: "Pije" }]);
  api.itemsGET.mockResolvedValue({ items: [], totalCount: 0 });
});

describe("Discount rules", () => {
  it("lists rules with their customer, category, percent and status", async () => {
    renderPage();
    expect(await screen.findByText("Pije verore")).toBeInTheDocument();
    expect(screen.getByText("Market Arbeni")).toBeInTheDocument();
    expect(screen.getByText("7.50%")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(api.listDiscountRules).toHaveBeenCalledWith("c1", undefined);
  });

  it("filters to rules valid today from the URL", async () => {
    renderPage("/discount-rules?active=1");
    await waitFor(() => expect(api.listDiscountRules).toHaveBeenCalledWith("c1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)));
  });

  it("asks for a target before saving, then creates the rule", async () => {
    api.createDiscountRule.mockResolvedValue({ ...RULE, id: "r2" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New discount rule" }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rabat Arbeni" } });
    fireEvent.change(screen.getByLabelText(/^Discount %/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Choose a customer, an item category or an item.")).toBeInTheDocument();
    expect(api.createDiscountRule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("combobox", { name: /^Customer/ }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Market Arbeni/ }));
    expect(screen.queryByRole("option", { name: /Furnitori/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createDiscountRule).toHaveBeenCalled());
    expect(api.createDiscountRule.mock.calls[0][1]).toMatchObject({ name: "Rabat Arbeni", percent: 5, partnerId: "p1", priority: 0, isActive: true });
  });
});
