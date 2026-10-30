import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CreateEmployeeLoanRequest, SaveCommissionPlanRequest } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { CommissionPlans } from "@/pages/payroll/CommissionPlans";
import { EmployeeLoansPanel } from "@/pages/payroll/EmployeeLoans";

const companyId = "11111111-1111-1111-1111-111111111111";

const createPlanMock = vi.fn(async (_c: string, body: SaveCommissionPlanRequest) => ({ id: "p1", ...body, employeeCount: 0 }));
const createLoanMock = vi.fn(async (_c: string, body: CreateEmployeeLoanRequest) => ({ id: "l1", ...body }));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listCommissionPlans: async () => [],
      createCommissionPlan: (c: string, body: SaveCommissionPlanRequest) => createPlanMock(c, body),
      listEmployeeLoans: async () => [
        {
          id: "l0", employeeId: "e1", employeeName: "Arta", kind: 0, principal: 250, issuedOn: "2026-08-20", installmentAmount: 100,
          firstPeriod: "2026-09-01", state: "Active", repaidPosted: 100, inDraftRuns: 0, outstanding: 150,
          disbursementJournalEntryId: "j1", notes: undefined, repayments: [],
        },
      ],
      paymentMethodsAll: async () => [{ id: "pm1", name: "TEB account", kind: 1, ledgerAccountId: "acc-bank", isActive: true }],
      createEmployeeLoan: (c: string, body: CreateEmployeeLoanRequest) => createLoanMock(c, body),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: companyId, activeCompany: { id: companyId, name: "Test Co" } }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isAdmin: true }, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

function renderWith(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Commission plans", () => {
  it("sends the typed percentage as a fraction", async () => {
    renderWith(<CommissionPlans />);
    fireEvent.click(await screen.findByRole("button", { name: "New plan" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sales 3%" } });
    fireEvent.change(screen.getByLabelText("Rate (%)"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Minimum monthly basis"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createPlanMock).toHaveBeenCalled());
    expect(createPlanMock.mock.calls[0][1]).toEqual({ name: "Sales 3%", basis: 0, rate: 0.03, minThreshold: 500, isActive: true });
  });
});

describe("Employee loans", () => {
  it("shows the API's outstanding balance and issues a loan from the chosen account", async () => {
    renderWith(<EmployeeLoansPanel companyId={companyId} employeeId="e1" />);
    expect(await screen.findByText("150.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New advance or loan" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Monthly installment"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("First recovered in"), { target: { value: "2026-11" } });
    // The account list loads when the form opens; issuing needs it.
    await screen.findByText("TEB account");
    fireEvent.click(screen.getByRole("button", { name: "Issue and pay out" }));

    await waitFor(() => expect(createLoanMock).toHaveBeenCalled());
    expect(createLoanMock.mock.calls[0][1]).toMatchObject({
      employeeId: "e1",
      principal: 300,
      installmentAmount: 100,
      firstPeriod: "2026-11-01",
      cashOrBankAccountId: "acc-bank",
    });
  });
});
