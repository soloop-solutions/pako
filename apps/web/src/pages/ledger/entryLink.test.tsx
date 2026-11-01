import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

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

const ENTRY = {
  id: "e1",
  journalId: "j1",
  date: "2026-03-05",
  reference: "REF-9",
  remarks: "Rent",
  state: "Posted",
  sequenceNumber: "JE-0009",
  lines: [
    { id: "l1", accountId: "a1", debit: 120, credit: 0, description: "Rent debit" },
    { id: "l2", accountId: "a2", debit: 0, credit: 120, description: undefined },
  ],
};

function Probe() {
  return <div data-testid="location">{useLocation().search}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Ledger />
          <Probe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("ledger ?entry=", () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.accountsAll.mockResolvedValue([
      { id: "a1", code: "540", name: "Rent expense" },
      { id: "a2", code: "100", name: "Cash" },
    ]);
    m.journalsAll.mockResolvedValue([{ id: "j1", code: "GJ", name: "General" }]);
    m.journalEntriesAll.mockResolvedValue([ENTRY]);
    m.trialBalance.mockResolvedValue([]);
    m.trialBalanceTotals.mockResolvedValue({ opening: 0, debit: 0, credit: 0, closing: 0 });
  });

  it("opens the entry with its lines and clears the param on close", async () => {
    renderAt("/ledger?entry=e1&fromDate=2026-01-01");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("JE-0009");
    expect(dialog).toHaveTextContent("540 Rent expense");
    expect(dialog).toHaveTextContent("100 Cash");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("location").textContent).toBe("?fromDate=2026-01-01");
  });

  it("opens from a row click", async () => {
    renderAt("/ledger");
    fireEvent.click(await screen.findByText("REF-9"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("JE-0009");
    expect(screen.getByTestId("location").textContent).toBe("?entry=e1");
  });

  it("ignores an unknown id", async () => {
    renderAt("/ledger?entry=nope");
    expect(await screen.findByText("REF-9")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
