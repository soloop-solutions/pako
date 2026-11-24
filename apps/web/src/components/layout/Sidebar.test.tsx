import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/components/layout/Sidebar";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { saveSidebarFocus } from "@/lib/sidebar-prefs";

const getMyAccess = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getMyAccess: (...args: unknown[]) => getMyAccess(...args),
      invoiceViewCounts: async () => ({ all: 12, draft: 3, posted: 9, overdue: 2 }),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { userId: "user-1" } }),
  useOptionalAuth: () => ({ auth: { userId: "user-1" } }),
}));

const FULL = { sales: 2, purchases: 2, partners: 2, accounting: 2, reports: 2, hr: 2 };

/** Opens every "Show more" so pages past a category's first few are in the document. */
async function expandAll() {
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^Show more/ }).length).toBeGreaterThan(0));
  for (const button of screen.getAllByRole("button", { name: /^Show more/ })) fireEvent.click(button);
}

function renderSidebar(showAll = true) {
  saveSidebarFocus("user-1", !showAll);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Sidebar />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
  return result;
}

describe("Sidebar module access", () => {
  beforeEach(() => {
    getMyAccess.mockReset();
    localStorage.clear();
  });

  it("folds every section except the one holding the open page until Show all sections is pressed", async () => {
    getMyAccess.mockResolvedValue({ isStaff: false, canWrite: true, isAdmin: true, partnerRestricted: false, assignedPartnerCount: 0, modules: FULL });
    renderSidebar(false);

    await waitFor(() => expect(getMyAccess).toHaveBeenCalled());
    expect(screen.queryByText("Employees")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all sections" }));
    expect(screen.getByText("Employees")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse sections" })).toBeInTheDocument();
  });

  it("shows the HR category for a user with full access", async () => {
    getMyAccess.mockResolvedValue({ isStaff: false, canWrite: true, isAdmin: true, partnerRestricted: false, assignedPartnerCount: 0, modules: FULL });
    renderSidebar();

    await waitFor(() => expect(getMyAccess).toHaveBeenCalled());
    expect(screen.getByText("Employees")).toBeInTheDocument();
    expect(screen.getByText("Departments")).toBeInTheDocument();
  });

  it("hides the HR and Accounting categories when the staff department has no access to them", async () => {
    getMyAccess.mockResolvedValue({
      isStaff: true,
      canWrite: true,
      isAdmin: false,
      employeeId: "emp-1",
      departmentName: "Sales",
      partnerRestricted: true,
      assignedPartnerCount: 3,
      // Payroll is its own area since roles (docs/USER_ACCESS_PLAN.md); this user has none.
      modules: { ...FULL, hr: 0, payroll: 0, accounting: 0 },
    });
    renderSidebar();

    await waitFor(() => expect(screen.queryByText("Employees")).not.toBeInTheDocument());
    expect(screen.queryByText("Departments")).not.toBeInTheDocument();
    expect(screen.queryByText("HR")).not.toBeInTheDocument();
    expect(screen.queryByText("Chart of accounts")).not.toBeInTheDocument();
    // Sales stays visible, and the partner-scope hint appears.
    expect(screen.getByText("Sales invoices")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-partner-scope")).toHaveTextContent("Showing 3 assigned partners");
  });

  // Business types: vertical pages follow the company's packs (my-access `features`).
  it("hides hotel pages for a Market company and shows them for a Hotel company", async () => {
    getMyAccess.mockResolvedValue({
      isStaff: false, canWrite: true, isAdmin: true, partnerRestricted: false, assignedPartnerCount: 0, modules: FULL,
      businessType: 1, features: ["grocery", "onlineSales"],
    });
    const market = renderSidebar();
    await waitFor(() => expect(getMyAccess).toHaveBeenCalled());
    await expandAll();
    expect(await screen.findByText("Online sales")).toBeInTheDocument();
    expect(screen.queryByText("Guest register")).not.toBeInTheDocument();
    expect(screen.queryByText("Pharmacy")).not.toBeInTheDocument();
    // Every page of the Projects group is off, so the group itself is hidden.
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    market.unmount();

    getMyAccess.mockResolvedValue({
      isStaff: false, canWrite: true, isAdmin: true, partnerRestricted: false, assignedPartnerCount: 0, modules: FULL,
      businessType: 3, features: ["hotel", "hospitality", "events"],
    });
    renderSidebar();
    await waitFor(() => expect(getMyAccess).toHaveBeenCalledTimes(2));
    await expandAll();
    expect(await screen.findByText("Guest register")).toBeInTheDocument();
    expect(screen.queryByText("Online sales")).not.toBeInTheDocument();
  });

  it("shows no vertical pages while the company's packs are loading", () => {
    getMyAccess.mockReturnValue(new Promise(() => {}));
    renderSidebar();
    expect(screen.getByText("Sales invoices")).toBeInTheDocument();
    expect(screen.queryByText("Guest register")).not.toBeInTheDocument();
  });
});

// Client request 2026-11-24: role menu groups ("My work") first, made of the usual pages.
describe("Sidebar role menu groups", () => {
  beforeEach(() => {
    getMyAccess.mockReset();
    localStorage.clear();
  });

  it("lists the user's groups under My work, above the usual sections", async () => {
    getMyAccess.mockResolvedValue({
      isStaff: true, canWrite: true, isAdmin: false, partnerRestricted: false, assignedPartnerCount: 0,
      modules: { ...FULL, inventory: 2, pos: 2 }, menuGroups: ["sales", "warehouse"],
    });
    renderSidebar();

    expect(await screen.findByTestId("sidebar-my-work")).toHaveTextContent("My work");
    const sales = screen.getByRole("button", { name: "Collapse Sales team" });
    const warehouse = screen.getByRole("button", { name: "Collapse Warehouse" });
    // In the server's order, and before the first usual section.
    expect(sales.compareDocumentPosition(warehouse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const firstUsual = screen.getAllByRole("button", { name: /^Collapse / }).find((b) => !/Sales team|Warehouse|sections/.test(b.getAttribute("aria-label") ?? b.textContent ?? ""))!;
    expect(warehouse.compareDocumentPosition(firstUsual) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A page in a group is still in its usual section too.
    expect(screen.getAllByRole("link", { name: /Sales invoices/ }).length).toBeGreaterThanOrEqual(2);
  });

  it("drops a group's pages the user's access does not allow, and shows no My work without groups", async () => {
    getMyAccess.mockResolvedValue({
      isStaff: true, canWrite: true, isAdmin: false, partnerRestricted: false, assignedPartnerCount: 0,
      modules: { sales: 0, purchases: 0, partners: 0, accounting: 2, reports: 0, hr: 0 }, menuGroups: ["accountant"],
    });
    const { unmount } = renderSidebar();
    expect(await screen.findByTestId("sidebar-my-work")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sales invoices/ })).not.toBeInTheDocument();
    unmount();

    getMyAccess.mockResolvedValue({ isStaff: false, canWrite: true, isAdmin: true, partnerRestricted: false, assignedPartnerCount: 0, modules: FULL });
    renderSidebar();
    await waitFor(() => expect(getMyAccess).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("sidebar-my-work")).not.toBeInTheDocument();
  });

  it("search lists a page once even when it sits in several groups", async () => {
    getMyAccess.mockResolvedValue({
      isStaff: false, canWrite: true, isAdmin: true, partnerRestricted: false, assignedPartnerCount: 0,
      modules: FULL, menuGroups: ["accountant", "manager"],
    });
    renderSidebar();
    await screen.findByTestId("sidebar-my-work");
    fireEvent.change(screen.getByRole("textbox", { name: /filter|Filter|Search|search/ }), { target: { value: "Sales invoices" } });
    expect(screen.getAllByRole("link", { name: /Sales invoices/ })).toHaveLength(1);
  });
});

// Client request 2026-11-24: the built-in saved views show how many documents each holds.
describe("Sidebar saved view counts", () => {
  beforeEach(() => {
    getMyAccess.mockReset();
    localStorage.clear();
  });

  it("shows the server's counts beside All, Drafts and Posted", async () => {
    getMyAccess.mockResolvedValue({ isStaff: false, canWrite: true, isAdmin: true, partnerRestricted: false, assignedPartnerCount: 0, modules: FULL });
    renderSidebar();
    await waitFor(() => expect(getMyAccess).toHaveBeenCalled());

    const invoices = screen.getAllByRole("link", { name: /Sales invoices/ })[0].closest("div")!.parentElement!;
    fireEvent.click(within(invoices).getByRole("button", { name: /saved views/i }));

    expect(await screen.findByTestId("saved-view-count-all")).toHaveTextContent("12");
    expect(screen.getByTestId("saved-view-count-draft")).toHaveTextContent("3");
    expect(screen.getByTestId("saved-view-count-posted")).toHaveTextContent("9");
  });
});
