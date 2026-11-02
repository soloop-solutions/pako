import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { BusinessTypeSettings } from "@/pages/settings/BusinessTypeSettings";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const getMyAccess = vi.fn();
const updateBusinessType = vi.fn();
const refresh = vi.fn(async () => {});

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getMyAccess: (...args: unknown[]) => getMyAccess(...args),
      updateCompanyBusinessType: (...args: unknown[]) => updateBusinessType(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    activeCompanyId: COMPANY_ID,
    companies: [{ id: COMPANY_ID, name: "Dardania Market", businessType: 1, features: ["grocery", "onlineSales"] }],
    refresh,
  }),
}));

function access(isAdmin: boolean, businessType = 1, features = ["grocery", "onlineSales"]) {
  return { isStaff: !isAdmin, canWrite: true, isAdmin, partnerRestricted: false, assignedPartnerCount: 0, modules: {}, businessType, features };
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <BusinessTypeSettings companyId={COMPANY_ID} />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Settings → Business type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyAccess.mockReset();
    updateBusinessType.mockReset();
  });

  it("shows the type and its packs; only administrators may change it", async () => {
    getMyAccess.mockResolvedValue(access(false));
    renderCard();
    expect(await screen.findByTestId("business-type-current")).toHaveTextContent("Market / shop");
    expect(screen.getByTestId("business-type-packs")).toHaveTextContent("Grocery");
    expect(screen.getByTestId("business-type-packs")).toHaveTextContent("Online sales");
    expect(await screen.findByText("Only a company administrator can change the business type.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change business type" })).not.toBeInTheDocument();
  });

  it("changes the type after a confirmation that the packs reset, then reloads the access", async () => {
    getMyAccess.mockResolvedValue(access(true));
    updateBusinessType.mockResolvedValue({ id: COMPANY_ID, name: "Dardania Market", businessType: 3, features: ["hotel", "hospitality", "events"] });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Change business type" }));
    fireEvent.click(screen.getByRole("radio", { name: /^Hotel \/ guesthouse/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Change the business type to Hotel / guesthouse?");
    expect(dialog).toHaveTextContent("The packs reset to this type's: Hotel, Restaurant, and Events.");
    expect(updateBusinessType).not.toHaveBeenCalled();

    getMyAccess.mockResolvedValue(access(true, 3, ["hotel", "hospitality", "events"]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Change and reset packs" }));
    await waitFor(() => expect(updateBusinessType).toHaveBeenCalledWith(COMPANY_ID, { businessType: 3 }));
    await waitFor(() => expect(screen.getByTestId("business-type-current")).toHaveTextContent("Hotel / guesthouse"));
    expect(getMyAccess).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalled();
  });
});
