import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { ChartOfAccounts } from "@/pages/ledger/ChartOfAccounts";

// F2's screen now calls the real generated client directly (accountsAll/accountsPOST/
// accountsPUT/deactivate/accountGroups — B1/B2/B3 landed the real backend for all of these). This
// test mocks apiClient itself, same pattern as Partners.test.tsx — there is no msw mock layer left
// for this screen to exercise.
const accountsAll = vi.fn();
const accountGroups = vi.fn();
const accountsPOST = vi.fn();
const accountsPUT = vi.fn();
const deactivate = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      accountsAll: (...args: unknown[]) => accountsAll(...args),
      accountGroups: (...args: unknown[]) => accountGroups(...args),
      accountsPOST: (...args: unknown[]) => accountsPOST(...args),
      accountsPUT: (...args: unknown[]) => accountsPUT(...args),
      deactivate: (...args: unknown[]) => deactivate(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

// Mirrors the real two-level hierarchy AccountGroupTemplate.cs seeds: one Class-level parent
// (ParentGroupId null) and one Group-level child nested under it.
const ASSETS_GROUP = { id: "group-1", name: "Assets", codePrefixStart: "100000", codePrefixEnd: "199999", parentGroupId: undefined };
const CASH_GROUP = { id: "group-10", name: "Cash and Cash Equivalents", codePrefixStart: "100000", codePrefixEnd: "109999", parentGroupId: "group-1" };

const MAIN_CASH: Record<string, unknown> = {
  id: "acc-1",
  code: "100100",
  name: "Main Cash",
  nameSq: "Arka kryesore",
  accountType: 0,
  accountSubType: 4,
  parentAccountId: undefined,
  isReconcilable: false,
  createdAt: "2026-08-26T00:00:00Z",
  class: 1,
  group: 10,
  statement: 0,
  normalBalance: 0,
  subledger: 6,
  isControl: false,
  isPostable: true,
  defaultVatCode: undefined,
  citDeductibility: 3,
  citLimitRule: undefined,
  profiles: 1,
  isActive: true,
  validFrom: undefined,
  validTo: undefined,
  groupId: "group-10",
  cashFlowCategory: 0,
};

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
    accountsAll.mockReset();
    accountGroups.mockReset();
    accountsPOST.mockReset();
    accountsPUT.mockReset();
    deactivate.mockReset();
    accountsAll.mockResolvedValue([MAIN_CASH]);
    accountGroups.mockResolvedValue([ASSETS_GROUP, CASH_GROUP]);
  });

  it("loads real accounts and groups them by the real two-level group hierarchy", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());
    expect(screen.getByText("Arka kryesore")).toBeInTheDocument();
    // Group header combines the Class-level parent's name with the account's own Group-level
    // (leaf) group name — "Assets · Cash and Cash Equivalents" — not a client-derived code prefix.
    expect(screen.getByText(/Assets · Cash and Cash Equivalents/)).toBeInTheDocument();
  });

  it("adds a new account under a chosen (leaf-only) group", async () => {
    accountsPOST.mockResolvedValue({ ...MAIN_CASH, id: "acc-2", code: "100200", name: "Test Cash Drawer", groupId: "group-10" });

    renderPage();
    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add account" }));

    // Only the Group-level (leaf) group is offered — the Class-level parent is never a valid
    // creation target on its own.
    expect(screen.queryByRole("option", { name: "Assets" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Assets · Cash and Cash Equivalents" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "100200" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test Cash Drawer" } });

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(accountsPOST).toHaveBeenCalled());
    const [companyId, body] = accountsPOST.mock.calls[0];
    expect(companyId).toBe("11111111-1111-1111-1111-111111111111");
    // B13: Class 1/Group 10 derives to AccountType.Cash (1) in the real 19-value scheme, not the
    // old 5-value scheme's AccountType.Asset (0) this test originally asserted.
    expect(body).toMatchObject({ code: "100200", name: "Test Cash Drawer", class: 1, group: 10, accountType: 1 });
  });

  it("rejects a code outside the selected group's range before submitting", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "200100" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad Code" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/100000.*109999/)).toBeInTheDocument();
    expect(accountsPOST).not.toHaveBeenCalled();
  });

  it("edits an existing account's name, sending the unchanged code back (R25)", async () => {
    accountsPUT.mockResolvedValue({ ...MAIN_CASH, name: "Main Cash (Renamed)" });
    // The edit's onSuccess invalidates and refetches the accounts list — queue what that refetch
    // should return, since accountsPUT's own response isn't what repopulates the grid.
    accountsAll.mockResolvedValueOnce([MAIN_CASH]).mockResolvedValueOnce([{ ...MAIN_CASH, name: "Main Cash (Renamed)" }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());

    const row = findRow("Main Cash");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const codeInput = await screen.findByLabelText("Code");
    expect(codeInput).toBeDisabled();

    const nameInput = screen.getByDisplayValue("Main Cash");
    fireEvent.change(nameInput, { target: { value: "Main Cash (Renamed)" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(accountsPUT).toHaveBeenCalled());
    const [, accountId, body] = accountsPUT.mock.calls[0];
    expect(accountId).toBe("acc-1");
    expect(body).toMatchObject({ code: "100100", name: "Main Cash (Renamed)" });
    await waitFor(() => expect(screen.getByText("Main Cash (Renamed)")).toBeInTheDocument());
  });

  it("deactivates an account after confirmation", async () => {
    deactivate.mockResolvedValue({ ...MAIN_CASH, isActive: false });

    renderPage();
    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());

    const row = findRow("Main Cash");
    fireEvent.click(within(row).getByRole("button", { name: "Deactivate" }));
    fireEvent.click(within(row).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(deactivate).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", "acc-1"));
  });

  it("still loads correctly after a StrictMode double-mount", async () => {
    renderPageInStrictMode();

    await waitFor(() => expect(screen.getByText("Main Cash")).toBeInTheDocument());
    expect(screen.getByText(/Assets · Cash and Cash Equivalents/)).toBeInTheDocument();
  });
});
