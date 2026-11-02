import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/components/layout/Sidebar";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

const getMyAccess = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, getMyAccess: (...args: unknown[]) => getMyAccess(...args) },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { userId: "user-1" } }),
}));

const FULL = { sales: 2, purchases: 2, partners: 2, accounting: 2, reports: 2, hr: 2 };

/** Opens every "Show more" so pages past a category's first few are in the document. */
async function expandAll() {
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^Show more/ }).length).toBeGreaterThan(0));
  for (const button of screen.getAllByRole("button", { name: /^Show more/ })) fireEvent.click(button);
}

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Sidebar />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Sidebar module access", () => {
  beforeEach(() => {
    getMyAccess.mockReset();
    localStorage.clear();
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
