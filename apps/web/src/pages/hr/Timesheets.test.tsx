import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Timesheets } from "@/pages/hr/Timesheets";
import { PartnerStatement } from "@/pages/partners/PartnerStatement";

const companyId = "11111111-1111-1111-1111-111111111111";
const approveMock = vi.fn(async (companyId: string, body: unknown) => {
  void companyId;
  void body;
  return [];
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getTimesheetSummary: async () => [
        { employeeId: "e1", employeeName: "Arta", regular: 160, overtime: 10, night: 0, weekend: 8, holiday: 0, unapproved: 3, locked: false },
      ],
      listTimeEntries: async () => [],
      approveTimesheetMonth: (c: string, body: unknown) => approveMock(c, body),
      partnersAll: async () => [{ id: "p1", name: "Viva Fresh" }],
      getPartnerStatement: async () => ({
        partnerId: "p1", partnerName: "Viva Fresh", from: "2026-01-01", to: "2026-12-31",
        openingBalance: 0, totalDebit: 1000, totalCredit: 400, closingBalance: 600,
        lines: [
          { date: "2026-02-01", reference: "INV-0001", description: undefined, accountCode: "110100", debit: 1000, credit: 0, balance: 1000 },
          { date: "2026-03-01", reference: "SUP-A", description: undefined, accountCode: "200100", debit: 0, credit: 400, balance: 600 },
        ],
      }),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: companyId, activeCompany: { id: companyId, name: "Test Co" } }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isAdmin: true }, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

function renderAt(node: React.ReactNode, url = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Timesheets", () => {
  it("shows the month's hours by kind and approves the month after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAt(<Timesheets />, "/timesheets?month=2026-09");
    expect(await screen.findByText("Arta")).toBeInTheDocument();
    expect(screen.getByText("3 to approve")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve month" }));
    await waitFor(() => expect(approveMock).toHaveBeenCalled());
    expect(approveMock.mock.calls[0][1]).toEqual({ month: "2026-09-01", employeeId: undefined });
  });
});

describe("Partner statement", () => {
  it("renders the API's balances for the partner in the URL", async () => {
    renderAt(<PartnerStatement />, "/partner-statement?partner=p1&from=2026-01-01&to=2026-12-31");
    expect(await screen.findByText("INV-0001")).toBeInTheDocument();
    expect(screen.getByText("Closing balance")).toBeInTheDocument();
    expect(screen.getAllByText("600.00").length).toBeGreaterThan(0);
  });
});
