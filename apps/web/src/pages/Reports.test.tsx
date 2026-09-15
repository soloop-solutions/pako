import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompanyResponse, ProfitAndLossResponse } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Reports } from "@/pages/Reports";

// Regression test for the F10 bug found in code review: the lock badge (and the exported file's
// lock notice) must reflect the period the currently-displayed report was actually loaded for, not
// the live, possibly-edited-but-not-yet-submitted date inputs. Editing a date field after a
// successful load must not change the badge until "Run report" is clicked again.

const activeCompany: CompanyResponse = {
  id: "c1",
  name: "Test Co",
  firmId: undefined,
  accountingLockDate: "2026-08-31",
  taxLockDate: undefined,
  enabledProfiles: 1,
  isVatRegistered: true,
  allowNumberOverride: false,
};

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [activeCompany],
    activeCompanyId: activeCompany.id,
    activeCompany,
    loading: false,
    error: null,
    setActiveCompanyId: vi.fn(),
    createCompany: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function pnlResponse(from: string, to: string): ProfitAndLossResponse {
  return { from, to, income: [], expenses: [], totalIncome: 0, totalExpenses: 0, netIncome: 0 };
}

const profitAndLoss = vi.fn(async (_companyId: string, from: string, to: string) => pnlResponse(from, to));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: { ...actual.apiClient, profitAndLoss: (companyId: string, from: string, to: string) => profitAndLoss(companyId, from, to) },
  };
});

function renderPage() {
  return render(
    <IntlProviderWrapper>
      <Reports />
    </IntlProviderWrapper>,
  );
}

describe("Reports — lock badge reflects loaded data, not live inputs", () => {
  it("keeps showing the loaded period's lock status after the date input is edited without re-running", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-08-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));

    await waitFor(() => expect(profitAndLoss).toHaveBeenCalledWith("c1", expect.any(String), "2026-08-31"));
    await waitFor(() => expect(screen.getByText("Locked")).toBeInTheDocument());
    expect(screen.getByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();

    // Edit the date to an unlocked one WITHOUT clicking "Run report" again.
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-30" } });

    // The badge must still reflect the loaded (locked) period — not the edited, unsubmitted one.
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();

    // Running the report again for the new, unlocked period updates the badge.
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(profitAndLoss).toHaveBeenCalledWith("c1", expect.any(String), "2026-09-30"));
    await waitFor(() => expect(screen.queryByText("Locked")).not.toBeInTheDocument());
  });
});
