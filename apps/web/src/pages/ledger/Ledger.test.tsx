import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

import totalsFixture from "@/mocks/trial-balance-totals.json";

import { fileResponse } from "../reports/testHarness";
import { Ledger } from "./Ledger";

const m = vi.hoisted(() => ({
  accountsAll: vi.fn(),
  journalsAll: vi.fn(),
  journalEntriesAll: vi.fn(),
  trialBalance: vi.fn(),
  trialBalanceExport: vi.fn(),
  trialBalanceTotals: vi.fn(),
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
    m.trialBalanceTotals.mockResolvedValue(totalsFixture);
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

  it("keeps both From and To when they are set in quick succession", async () => {
    renderLedger("/ledger");
    await screen.findByText("Trade receivables");
    const from = screen.getByLabelText("From", { selector: "#trial-balance-from" });
    const to = screen.getByLabelText("To", { selector: "#trial-balance-to" });
    act(() => {
      fireEvent.change(from, { target: { value: "2026-02-01" } });
      fireEvent.change(to, { target: { value: "2026-02-28" } });
    });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("tbTo=2026-02-28"));
    expect(screen.getByTestId("location").textContent).toContain("tbFrom=2026-02-01");
  });

  it("shows the server totals row with and without a period", async () => {
    m.trialBalanceTotals.mockResolvedValue({ opening: 10.5, debit: 1550, credit: 1549.5, closing: 11 });
    renderLedger("/ledger?tbFrom=2026-01-01&tbTo=2026-03-31");
    await screen.findByText("Trade receivables");
    await waitFor(() => expect(m.trialBalanceTotals).toHaveBeenCalledWith("c1", "2026-01-01", "2026-03-31"));
    const footer = document.querySelector("tfoot") as HTMLElement;
    await waitFor(() => expect(footer.textContent).toContain("1550.00"));
    expect(footer.textContent).toContain("Total");
    expect(footer.textContent).toContain("10.50");
    expect(footer.textContent).toContain("1549.50");
    expect(footer.textContent).toContain("11.00");
  });

  it("requests totals with no period when none is set", async () => {
    renderLedger("/ledger");
    await screen.findByText("Trade receivables");
    await waitFor(() => expect(m.trialBalanceTotals).toHaveBeenCalledWith("c1", undefined, undefined));
    await waitFor(() => expect(document.querySelector("tfoot")?.textContent).toContain("1550.00"));
  });
});
