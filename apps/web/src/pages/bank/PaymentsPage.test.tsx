import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PaymentsPage } from "@/pages/bank/PaymentsPage";

const companyId = "11111111-1111-1111-1111-111111111111";
const paymentsMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { items: [], total: 0, page: 2, pageSize: 25 };
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { ...actual.apiClient, payments: (...args: unknown[]) => paymentsMock(...args) } };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: companyId, activeCompany: { id: companyId, name: "Test Co" } }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isAdmin: true }, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

// UI/UX round 2026-11-24: the grid's page, size and sort reach the API.
describe("Payments page", () => {
  it("sends the grid's page, page size and sort to the server", async () => {
    render(
      <MemoryRouter initialEntries={["/payments?payments.page=2&payments.pageSize=25&payments.sort=amount"]}>
        <IntlProviderWrapper>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <PaymentsPage />
          </QueryClientProvider>
        </IntlProviderWrapper>
      </MemoryRouter>,
    );
    await waitFor(() => expect(paymentsMock).toHaveBeenCalled());
    expect(paymentsMock).toHaveBeenCalledWith(companyId, undefined, undefined, undefined, 2, 25, "amount");
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });
});
