import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import totalsFixture from "@/mocks/trial-balance-totals.json";

import { Ledger } from "./Ledger";

const m = vi.hoisted(() => ({
  accountsAll: vi.fn(),
  journalsAll: vi.fn(),
  journalEntriesAll: vi.fn(),
  trialBalance: vi.fn(),
  trialBalanceTotals: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("../reports/testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});
vi.mock("@/pages/ledger/JournalEntryGrid", () => ({ JournalEntryGrid: () => null }));
vi.mock("@/pages/ledger/JournalEntriesTable", () => ({ JournalEntriesTable: () => null }));

const ACCOUNT_ID = "5b1f0c2e-1a11-4c01-9a03-000000000120";

const lines = [
  { accountId: ACCOUNT_ID, accountCode: "120", accountName: "Trade receivables", debit: 1180, credit: 0, balance: 1180, opening: 0, closing: 1180, class: 1, groupName: "Receivables" },
];

function Probe() {
  const location = useLocation();
  return <div data-testid="route">{location.pathname + location.search}</div>;
}

function renderLedger() {
  return render(
    <MemoryRouter initialEntries={["/ledger"]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient()}>
          <Ledger />
          <Probe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("trial balance rows", () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.accountsAll.mockResolvedValue([]);
    m.journalsAll.mockResolvedValue([]);
    m.journalEntriesAll.mockResolvedValue([]);
    m.trialBalance.mockResolvedValue(lines);
    m.trialBalanceTotals.mockResolvedValue(totalsFixture);
  });

  it("opens the account on row click", async () => {
    renderLedger();
    fireEvent.click(await screen.findByText("Trade receivables"));
    expect(screen.getByTestId("route").textContent).toBe(`/chart-of-accounts?open=${ACCOUNT_ID}`);
  });

  it("leaves the total row inert", async () => {
    renderLedger();
    await screen.findByText("Trade receivables");
    const total = screen.getByText("Total").closest("tr") as HTMLElement;
    expect(total.className).not.toContain("cursor-pointer");
    fireEvent.click(screen.getByText("Total"));
    expect(screen.getByTestId("route").textContent).toBe("/ledger");
  });
});
