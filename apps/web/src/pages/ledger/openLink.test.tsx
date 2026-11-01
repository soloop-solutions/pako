import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { ChartOfAccounts } from "@/pages/ledger/ChartOfAccounts";

const accountsAll = vi.fn();
const accountGroups = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      accountsAll: (...args: unknown[]) => accountsAll(...args),
      accountGroups: (...args: unknown[]) => accountGroups(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

const ACCOUNT = {
  id: "acc-1",
  code: "100100",
  name: "Main Cash",
  accountType: 0,
  accountSubType: 4,
  isReconcilable: false,
  class: 1,
  group: 10,
  statement: 0,
  normalBalance: 0,
  subledger: 6,
  isControl: false,
  isPostable: true,
  citDeductibility: 3,
  profiles: 1,
  isActive: true,
  cashFlowCategory: 0,
};

function Probe() {
  return <div data-testid="location">{useLocation().search}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ChartOfAccounts />
          <Probe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("chart of accounts ?open=", () => {
  beforeEach(() => {
    accountsAll.mockReset().mockResolvedValue([ACCOUNT]);
    accountGroups.mockReset().mockResolvedValue([]);
  });

  it("opens the edit dialog, keeps other params, and clears open on close", async () => {
    renderAt("/chart-of-accounts?view=tree&open=acc-1");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Edit account 100100");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const search = screen.getByTestId("location").textContent ?? "";
    expect(search).toContain("view=tree");
    expect(search).not.toContain("open=");
  });

  it("ignores an unknown id", async () => {
    renderAt("/chart-of-accounts?open=nope");
    await waitFor(() => expect(accountsAll).toHaveBeenCalled());
    expect(await screen.findByText("Main Cash")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
