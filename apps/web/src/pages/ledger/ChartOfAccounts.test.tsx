import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { ChartOfAccounts } from "@/pages/ledger/ChartOfAccounts";

// F2's real screen is exercised against the PROVISIONAL mock (src/mocks/handlers.ts) via
// src/test/setup.ts's msw/node server — this test proves the plumbing (grid, group-by, add/edit/
// deactivate) works end to end against that mock, the same contract the dev server uses.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <ChartOfAccounts />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

function renderPageInStrictMode() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <MemoryRouter>
        <IntlProviderWrapper>
          <QueryClientProvider client={queryClient}>
            <ChartOfAccounts />
          </QueryClientProvider>
        </IntlProviderWrapper>
      </MemoryRouter>
    </StrictMode>,
  );
}

function findRow(text: string): HTMLElement {
  const cell = screen.getByText(text);
  const row = cell.closest("tr");
  if (!row) throw new Error(`No row found for "${text}"`);
  return row;
}

describe("ChartOfAccounts", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads the mocked v2 accounts and groups them by code prefix", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());
    expect(screen.getByText("Arka kryesore")).toBeInTheDocument();
    // Group header for class 1 / group 10 accounts, e.g. "10 · Asset".
    expect(screen.getByText(/10 · Asset/)).toBeInTheDocument();
  });

  it("adds a new account under a chosen group", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add account" }));

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "109950" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test Cash Drawer" } });

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByText("Test Cash Drawer")).toBeInTheDocument());
    expect(screen.getByText("109950")).toBeInTheDocument();
  });

  it("edits an existing account's name", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());

    const row = findRow("Main Cash");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const nameInput = await screen.findByDisplayValue("Main Cash");
    fireEvent.change(nameInput, { target: { value: "Main Cash (Renamed)" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Main Cash (Renamed)")).toBeInTheDocument());
  });

  it("deactivates an account after confirmation", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());

    const row = findRow("Main Cash");
    fireEvent.click(within(row).getByRole("button", { name: "Deactivate" }));
    fireEvent.click(within(row).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(within(row).getByText("Inactive")).toBeInTheDocument());
    expect(row.className).toContain("text-muted-foreground");
  });

  // Real jsdom has no Service Worker API, so mockInit.ts's browser-worker code path never runs
  // here regardless — src/mocks/mockInit.test.ts is what actually proves the StrictMode
  // ref-counting race is closed. This test instead guards the surrounding piece: that mounting
  // this screen under StrictMode's mount1 -> cleanup1 -> mount2 double-invoke doesn't leave the
  // surviving instance in a broken state (stuck loading, unhandled rejection, query never
  // enabled) — it settles and shows the same mocked data a plain single mount would.
  it("still loads correctly after a StrictMode double-mount", async () => {
    renderPageInStrictMode();

    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());
    expect(screen.getByText(/10 · Asset/)).toBeInTheDocument();
  });
});
