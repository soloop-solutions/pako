import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModuleGate } from "@/components/ModuleGate";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

const getMyAccess = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, getMyAccess: (...args: unknown[]) => getMyAccess(...args) } };
});

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ activeCompanyId: "c1" }) }));

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <ModuleGate module="payroll">
            <p>Payroll runs</p>
          </ModuleGate>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("ModuleGate", () => {
  beforeEach(() => getMyAccess.mockReset());

  it("blocks a page whose module has no access", async () => {
    getMyAccess.mockResolvedValue({ modules: { payroll: 0 } });
    renderGate();
    expect(await screen.findByTestId("module-off")).toBeInTheDocument();
    expect(screen.queryByText("Payroll runs")).not.toBeInTheDocument();
  });

  it("shows the page when the module is available", async () => {
    getMyAccess.mockResolvedValue({ modules: { payroll: 3 } });
    renderGate();
    expect(await screen.findByText("Payroll runs")).toBeInTheDocument();
  });
});
