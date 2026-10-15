import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
      modules: { ...FULL, hr: 0, accounting: 0 },
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
});
