import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Employees } from "@/pages/hr/Employees";

const listEmployees = vi.fn();
const listDepartments = vi.fn();
const getMyAccess = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listEmployees: (...args: unknown[]) => listEmployees(...args),
      listDepartments: (...args: unknown[]) => listDepartments(...args),
      getMyAccess: (...args: unknown[]) => getMyAccess(...args),
    },
  };
});

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: COMPANY_ID }),
}));

const ARTA = {
  id: "emp-1",
  name: "Arta Krasniqi",
  firstName: "Arta",
  lastName: "Krasniqi",
  personalNumber: undefined,
  departmentName: "Sales",
  jobTitle: "Sales agent",
  hireDate: "2025-03-01",
  currentSalary: 450,
  monthlyGrossSalary: 450,
  isActive: true,
  warnings: ["BelowMinimumWage", "MissingPersonalNumber"],
};

function renderPage(url = "/employees") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Employees />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Employees", () => {
  beforeEach(() => {
    listEmployees.mockReset().mockResolvedValue({ items: [ARTA], total: 1, page: 1, pageSize: 50 });
    listDepartments.mockReset().mockResolvedValue([]);
    getMyAccess.mockReset().mockResolvedValue({
      isStaff: true,
      canWrite: false,
      isAdmin: false,
      partnerRestricted: false,
      assignedPartnerCount: 0,
      modules: { sales: 0, purchases: 0, partners: 0, accounting: 0, reports: 0, hr: 1 },
    });
  });

  it("renders the salary as returned and the warning codes as translated badges", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Arta Krasniqi")).toBeInTheDocument());
    expect(screen.getByText("450.00 €")).toBeInTheDocument();
    expect(screen.getByText("Below minimum wage")).toBeInTheDocument();
    expect(screen.getByText("No personal number")).toBeInTheDocument();
  });

  it("passes the URL filters and sort to the API and hides New employee for read-only HR access", async () => {
    renderPage("/employees?employees.dept=dept-9&employees.inactive=1&employees.sort=-salary&employees.q=arta");
    await waitFor(() =>
      expect(listEmployees).toHaveBeenCalledWith(COMPANY_ID, 1, 50, "arta", "-salary", "dept-9", true),
    );
    await waitFor(() => expect(getMyAccess).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "New employee" })).not.toBeInTheDocument());
  });
});
