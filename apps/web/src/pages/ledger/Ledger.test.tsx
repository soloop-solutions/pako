import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

import { fileResponse } from "../reports/testHarness";
import { Ledger } from "./Ledger";

const m = vi.hoisted(() => ({
  accountsAll: vi.fn(),
  journalsAll: vi.fn(),
  journalEntriesAll: vi.fn(),
  trialBalance: vi.fn(),
  trialBalanceExport: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("../reports/testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});
vi.mock("@/pages/ledger/JournalEntryGrid", () => ({ JournalEntryGrid: () => null }));
vi.mock("@/pages/ledger/JournalEntriesTable", () => ({ JournalEntriesTable: () => null }));

const lines = [
  {
    accountId: "a1",
    accountCode: "120",
    accountName: "Trade receivables",
    debit: 1180.0,
    credit: 0.0,
    balance: 1180.0,
    opening: 250.5,
    closing: 1430.5,
    class: 1,
    groupName: "Receivables",
  },
];

function Probe() {
  return <div data-testid="location">{useLocation().search}</div>;
}

function renderLedger(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient()}>
          <Ledger />
          <Probe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Ledger trial balance period", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.accountsAll.mockResolvedValue([]);
    m.journalsAll.mockResolvedValue([]);
    m.journalEntriesAll.mockResolvedValue([]);
    m.trialBalance.mockResolvedValue(lines);
    m.trialBalanceExport.mockResolvedValue(fileResponse("tb.xlsx"));
  });

  it("without a period keeps today's columns and sends no period", async () => {
    renderLedger("/ledger");
    expect(await screen.findByText("Trade receivables")).toBeInTheDocument();
    expect(m.trialBalance).toHaveBeenCalledWith("c1", undefined, undefined);
    expect(screen.getByRole("columnheader", { name: /Balance/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Opening/ })).not.toBeInTheDocument();
  });

  it("with a period shows Opening/Debit/Credit/Closing from the server fields", async () => {
    renderLedger("/ledger?tbFrom=2026-01-01&tbTo=2026-03-31");
    expect(await screen.findByText("Trade receivables")).toBeInTheDocument();
    expect(m.trialBalance).toHaveBeenCalledWith("c1", "2026-01-01", "2026-03-31");
    expect(screen.getByRole("columnheader", { name: /Opening/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Closing/ })).toBeInTheDocument();
    expect(screen.getByText("250.50")).toBeInTheDocument();
    expect(screen.getByText("1430.50")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Balance/ })).not.toBeInTheDocument();
  });

  it("writes the period to the URL and exports with the same period", async () => {
    renderLedger("/ledger");
    await screen.findByText("Trade receivables");
    fireEvent.change(screen.getByLabelText("From", { selector: "#trial-balance-from" }), { target: { value: "2026-02-01" } });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("tbFrom=2026-02-01"));
    await waitFor(() => expect(m.trialBalance).toHaveBeenLastCalledWith("c1", "2026-02-01", undefined));
    fireEvent.click(await screen.findByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.trialBalanceExport).toHaveBeenCalledWith("c1", "2026-02-01", undefined));
  });
});
