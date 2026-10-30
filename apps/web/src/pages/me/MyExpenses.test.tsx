import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SaveExpenseClaimRequest } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { FirmPayroll } from "@/pages/hr/FirmPayroll";
import { MyExpenses } from "@/pages/me/MyExpenses";

const companyId = "11111111-1111-1111-1111-111111111111";

const createMock = vi.fn(async (_c: string, body: SaveExpenseClaimRequest) => ({
  id: "c1", employeeId: "e1", employeeName: "Arta", title: body.title, stage: "Draft", total: 59,
  createdAt: "2026-10-30T10:00:00Z", submittedAt: undefined, decidedAt: undefined, decisionNote: undefined,
  billId: undefined, outstanding: 0, payrollReimbursementPeriod: undefined,
  lines: body.lines.map((l, i) => ({ id: `l${i}`, ...l, expenseAccountName: "600500 Travel" })), receipts: [],
}));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      listMyExpenseClaims: async () => [],
      getMyExpenseOptions: async () => ({ accounts: [{ id: "acc-travel", label: "600500 Travel" }], taxes: [{ id: "vat18", label: "TVSH 18%" }] }),
      listMyTeamExpenseClaims: async () => [],
      createMyExpenseClaim: (c: string, body: SaveExpenseClaimRequest) => createMock(c, body),
      getFirmPayrollOverview: async () => ({
        firmId: "f1", firmName: "Kontabiliteti", month: "2026-09-01",
        companies: [
          { companyId: "a", companyName: "Late Co", runId: undefined, runState: undefined, employeeCount: 4, totalGross: undefined, ediDueDate: "2026-10-15", daysRemaining: -2, status: "Overdue" },
          { companyId: "b", companyName: "Done Co", runId: "r1", runState: "Posted", employeeCount: 3, totalGross: 3000, ediDueDate: "2026-10-15", daysRemaining: -2, status: "Done" },
        ],
      }),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    activeCompanyId: companyId,
    activeCompany: { id: companyId, name: "Test Co", firmId: "f1" },
    companies: [],
    setActiveCompanyId: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isTeamManager: false, linkedEmployeeId: "e1" }, isLoading: false, isStaff: true, canSee: () => true, canWrite: () => true }),
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

describe("My expenses", () => {
  it("refuses an incomplete line, then saves a draft with the supplier details", async () => {
    renderWith(<MyExpenses />);
    fireEvent.click(await screen.findByRole("button", { name: "New expense claim" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Trip" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByText(/fill in date, description, category and amount/)).toBeInTheDocument();

    await screen.findByRole("option", { name: "600500 Travel" });
    fireEvent.change(screen.getByLabelText("What it was for"), { target: { value: "Fuel" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "acc-travel" } });
    fireEvent.change(screen.getByLabelText("Amount paid (VAT incl.)"), { target: { value: "59,00" } });
    fireEvent.change(screen.getByLabelText("VAT on the receipt"), { target: { value: "vat18" } });
    fireEvent.change(screen.getByLabelText("Shop / supplier"), { target: { value: "Petrol" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][1].lines[0]).toMatchObject({
      description: "Fuel", expenseAccountId: "acc-travel", amount: 59, taxDefinitionId: "vat18", supplierName: "Petrol",
    });
    expect(await screen.findByRole("button", { name: "Submit for approval" })).toBeInTheDocument();
  });
});

describe("Firm payroll overview", () => {
  it("flags an overdue client and shows posted ones as done", async () => {
    renderWith(<FirmPayroll />);
    expect(await screen.findByText("Late Co")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("None yet")).toBeInTheDocument();
    expect(screen.getAllByText("Posted").length).toBeGreaterThan(0);
  });
});
