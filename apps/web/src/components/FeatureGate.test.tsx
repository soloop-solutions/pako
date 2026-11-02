import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureGate } from "@/components/FeatureGate";
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
          <FeatureGate feature="hotel">
            <p>Hotel chart</p>
          </FeatureGate>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("FeatureGate", () => {
  beforeEach(() => getMyAccess.mockReset());

  it("explains that a page of a pack that is off isn't used by the company", async () => {
    getMyAccess.mockResolvedValue({ modules: {}, businessType: 1, features: ["grocery"] });
    renderGate();
    expect(await screen.findByText("This feature isn't used by this company")).toBeInTheDocument();
    expect(screen.queryByText("Hotel chart")).not.toBeInTheDocument();
  });

  it("shows the page when the pack is on", async () => {
    getMyAccess.mockResolvedValue({ modules: {}, businessType: 3, features: ["hotel", "hospitality", "events"] });
    renderGate();
    expect(await screen.findByText("Hotel chart")).toBeInTheDocument();
  });
});
