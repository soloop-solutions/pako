import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountResponse, JournalResponse } from "@pako/shared";
import { MemoryRouter } from "react-router-dom";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { JournalEntryGrid } from "@/pages/ledger/JournalEntryGrid";

// Same technique src/pages/partners/Partners.test.tsx already established: the real backend isn't
// running inside vitest, so apiClient's network methods are mocked directly rather than via msw —
// but the cost-center picker's own mock (src/mocks/costCentersHandlers.ts) genuinely round-trips
// through the real msw/node server wired up in src/test/setup.ts, same as ChartOfAccounts.test.tsx.
const partnersAll = vi.fn();
const projectsAll = vi.fn();
const listEmployees = vi.fn();
const journalEntriesCreate = vi.fn();
const post3 = vi.fn();
const actionTokens = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      partnersAll: (...args: unknown[]) => partnersAll(...args),
      projectsAll: (...args: unknown[]) => projectsAll(...args),
      listEmployees: (...args: unknown[]) => listEmployees(...args),
      journalEntries: (...args: unknown[]) => journalEntriesCreate(...args),
      post3: (...args: unknown[]) => post3(...args),
      actionTokens: (...args: unknown[]) => actionTokens(...args),
    },
  };
});

// The grid posts only with Accounting: Approve (docs/USER_ACCESS_PLAN.md); these tests have it.
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-1", name: "Test Company" } }),
}));

function testAccount(overrides: Partial<AccountResponse> & Pick<AccountResponse, "id" | "code" | "name" | "accountType" | "accountSubType">): AccountResponse {
  return {
    parentAccountId: undefined,
    isReconcilable: false,
    createdAt: "2026-01-01T00:00:00Z",
    nameSq: undefined,
    class: undefined,
    group: undefined,
    statement: undefined,
    normalBalance: undefined,
    subledger: undefined,
    isControl: false,
    isPostable: true,
    defaultVatCode: undefined,
    citDeductibility: undefined,
    citLimitRule: undefined,
    profiles: 0,
    isActive: true,
    validFrom: undefined,
    validTo: undefined,
    groupId: undefined,
    cashFlowCategory: 0,
    includeInitialBalance: true,
    ...overrides,
  };
}

const ACCOUNTS: AccountResponse[] = [
  testAccount({ id: "acc-cash", code: "100100", name: "Cash", accountType: 0, accountSubType: 4 }),
  testAccount({ id: "acc-rev", code: "400100", name: "Sales Revenue", accountType: 3, accountSubType: 0 }),
];

const JOURNALS: JournalResponse[] = [
  { id: "journal-gen", type: 0, code: "GEN", name: "General", sequencePrefix: "GEN", sequenceNextNumber: 1, sequencePadding: 4 },
];

function renderGrid(onCreated = vi.fn()) {
  partnersAll.mockResolvedValue([]);
  projectsAll.mockResolvedValue([]);
  listEmployees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  actionTokens.mockResolvedValue({ token: "test-action-token", expiresAtUtc: new Date(Date.now() + 300_000).toISOString() });
  return {
    onCreated,
    ...render(
      <MemoryRouter>
        <IntlProviderWrapper>
          <JournalEntryGrid companyId="company-1" journals={JOURNALS} accounts={ACCOUNTS} onCreated={onCreated} />
        </IntlProviderWrapper>
      </MemoryRouter>,
    ),
  };
}

/** After clicking Save, the password dialog appears — complete it so the actual create proceeds. */
async function completePasswordDialog() {
  const passwordInput = await screen.findByLabelText("Password");
  fireEvent.change(passwordInput, { target: { value: "testpassword" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Continue" }));
  await waitFor(() => expect(actionTokens).toHaveBeenCalled());
}

// getAllByRole("row") also picks up the header row and the totals <tfoot> row (both are real <tr>
// elements, which carry an implicit ARIA "row" role) — so with N body lines the grid always shows
// N + 2 rows total.
function totalRowCount(bodyLineCount: number): number {
  return bodyLineCount + 2;
}

function bodyRow(index: number): HTMLElement {
  // Row 0 is the header row.
  return screen.getAllByRole("row")[index + 1];
}

function cellInput(rowIndex: number, label: string): HTMLElement {
  return within(bodyRow(rowIndex)).getByLabelText(label);
}

// The Diferenca chip (Task 7) sits in the totals bar next to the debit/credit total cells, which
// can carry the same numeric text (e.g. both read "100.00") — so it must be found by its badge
// markup, not by text content scoped to the totals row.
function diferencaBadge(container: HTMLElement): HTMLElement {
  const badge = container.querySelector('[data-slot="badge"]');
  if (!badge) throw new Error("Diferenca badge not found");
  return badge as HTMLElement;
}

// Real DOM focus (not just dispatching a change event) before typing — matches how a user actually
// reaches a cell (click, or arrow/Tab/Enter from another cell, both of which the grid ties to real
// DOM focus via its own [focus]-keyed effect). Wrapped in `act()` so the effect that re-seeds the
// cell's draft from its committed value fully settles BEFORE the next synchronous statement — doing
// a raw `.focus()` un-wrapped can otherwise interleave with the following `fireEvent.change` and let
// that re-seed clobber the just-typed text.
function type(rowIndex: number, label: string, value: string) {
  const input = cellInput(rowIndex, label);
  act(() => {
    input.focus();
  });
  fireEvent.change(input, { target: { value } });
  return input;
}

function focusCell(rowIndex: number, label: string): HTMLElement {
  const input = cellInput(rowIndex, label);
  act(() => {
    input.focus();
  });
  return input;
}

describe("JournalEntryGrid keyboard model", () => {
  it("Enter commits the cell and moves down one row, growing the grid from the last row", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    expect(screen.getAllByRole("row")).toHaveLength(totalRowCount(2)); // 2 seed lines

    const lastRowDescription = type(1, "Description", "September rent");
    fireEvent.keyDown(lastRowDescription, { key: "Enter" });

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(totalRowCount(3)));
    expect(cellInput(1, "Description")).toHaveValue("September rent");
    // Description autofill decision: the new row inherits the previous line's description.
    expect(cellInput(2, "Description")).toHaveValue("September rent");
    expect(cellInput(2, "Description")).toHaveFocus();
  });

  it("Tab commits and moves right, wrapping to the first column of the next row", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const partnerCell = focusCell(1, "Partner");
    fireEvent.keyDown(partnerCell, { key: "Tab" });

    // Tab through Project → Employee → Cost Center (last column on the last row).
    const projectCell = cellInput(1, "Project");
    await waitFor(() => expect(projectCell).toHaveFocus());
    fireEvent.keyDown(projectCell, { key: "Tab" });

    const employeeCell = cellInput(1, "Employee");
    await waitFor(() => expect(employeeCell).toHaveFocus());
    fireEvent.keyDown(employeeCell, { key: "Tab" });

    const costCenterCell = cellInput(1, "Analytic distribution");
    await waitFor(() => expect(costCenterCell).toHaveFocus());

    fireEvent.keyDown(costCenterCell, { key: "Tab" });

    // Wrapping past the last column on the last row grows the grid and lands on its first column.
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(totalRowCount(3)));
    expect(cellInput(2, "Account")).toHaveFocus();
  });

  it("Escape reverts an in-progress edit without moving focus or committing it", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const description = type(0, "Description", "Unsaved typo");
    expect(description).toHaveValue("Unsaved typo");

    fireEvent.keyDown(description, { key: "Escape" });

    expect(description).toHaveValue("");
    expect(description).toHaveFocus();

    // Moving away confirms nothing was committed.
    fireEvent.keyDown(description, { key: "ArrowDown" });
    expect(cellInput(0, "Description")).toHaveValue("");
  });

  it("pastes a tab/newline-separated block starting at the focused cell, growing rows as needed", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const first = focusCell(0, "Description");
    const clipboardData = { getData: () => "Rent\t100.00\t\nUtilities\t50.00\t" };
    fireEvent.paste(first, { clipboardData });

    await waitFor(() => expect(cellInput(0, "Description")).toHaveValue("Rent"));
    expect(cellInput(0, "Debit")).toHaveValue("100.00");
    expect(cellInput(1, "Description")).toHaveValue("Utilities");
    expect(cellInput(1, "Debit")).toHaveValue("50.00");
  });

  it("grows the grid when a pasted block is larger than the remaining rows", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    // Only 2 rows exist (indices 0-1). Pasting a 3-row block starting at the last one (index 1)
    // needs rows 1, 2 and 3 — 2 of which don't exist yet.
    const anchor = focusCell(1, "Description");
    const clipboardData = { getData: () => "Row two\t10.00\nRow three\t20.00\nRow four\t30.00" };
    fireEvent.paste(anchor, { clipboardData });

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(totalRowCount(4)));
    expect(cellInput(1, "Description")).toHaveValue("Row two");
    expect(cellInput(1, "Debit")).toHaveValue("10.00");
    expect(cellInput(2, "Description")).toHaveValue("Row three");
    expect(cellInput(2, "Debit")).toHaveValue("20.00");
    expect(cellInput(3, "Description")).toHaveValue("Row four");
    expect(cellInput(3, "Debit")).toHaveValue("30.00");
  });

  it("disables Save and shows the exact difference while unbalanced, and auto-balance zeroes it", async () => {
    const { container } = renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const account0 = type(0, "Account", "100100");
    fireEvent.keyDown(account0, { key: "Tab" });
    const debit = type(0, "Debit", "100.00");
    fireEvent.keyDown(debit, { key: "Enter" }); // moves to row 2's Debit, same column

    // Row 2 needs an account too — auto-balance below will only count its line if it has one.
    const account1 = type(1, "Account", "400100");
    fireEvent.keyDown(account1, { key: "Tab" });

    await waitFor(() => expect(diferencaBadge(container)).toHaveTextContent("100.00"));
    expect(diferencaBadge(container).className).toContain("bg-warning");
    expect(screen.getByRole("button", { name: "Save and post" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Auto-balance last line" }));

    await waitFor(() => expect(cellInput(1, "Credit")).toHaveValue("100.00"));
    expect(screen.getByRole("button", { name: "Save and post" })).not.toBeDisabled();
    expect(diferencaBadge(container)).toHaveTextContent("0.00");
    expect(diferencaBadge(container).className).toContain("bg-success");
  });

  it("does not count a line's amount toward the totals or let Save through when that line has no account", async () => {
    const { container } = renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    // Line 1 (account) debit 100, line 2 (account) credit 60 — deliberately short by 40 on
    // their own, matching the bug report's exact reproduction.
    const account0 = type(0, "Account", "100100");
    fireEvent.keyDown(account0, { key: "Tab" });
    const debit0 = type(0, "Debit", "100.00");
    fireEvent.keyDown(debit0, { key: "Enter" });

    const account1 = type(1, "Account", "400100");
    fireEvent.keyDown(account1, { key: "Tab" });
    const credit1 = type(1, "Credit", "60.00");
    fireEvent.keyDown(credit1, { key: "Enter" }); // grows a 3rd, account-less row

    // The 3rd line has no account, but a stray 40 credit that would (wrongly) close the gap if
    // counted — it must not be.
    const credit2 = type(2, "Credit", "40.00");
    fireEvent.keyDown(credit2, { key: "Enter" });

    await waitFor(() => expect(diferencaBadge(container)).toHaveTextContent("40.00"));
    expect(diferencaBadge(container).className).toContain("bg-warning");
    expect(screen.getByRole("button", { name: "Save and post" })).toBeDisabled();
    expect(journalEntriesCreate).not.toHaveBeenCalled();
  });

  it("blocks Save with a specific message when a line has an amount but no account, even if the accounted lines alone balance", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const account0 = type(0, "Account", "100100");
    fireEvent.keyDown(account0, { key: "Tab" });
    const debit0 = type(0, "Debit", "100.00");
    fireEvent.keyDown(debit0, { key: "Enter" });

    const account1 = type(1, "Account", "400100");
    fireEvent.keyDown(account1, { key: "Tab" });
    const credit1 = type(1, "Credit", "100.00");
    fireEvent.keyDown(credit1, { key: "Enter" }); // grows a 3rd, account-less row

    const debit2 = type(2, "Debit", "40.00");
    fireEvent.keyDown(debit2, { key: "Enter" });

    // The two accounted lines already balance each other, so Save is enabled by the totals check
    // alone — but the stray-amount line must still block it explicitly.
    fireEvent.click(screen.getByRole("button", { name: "Save and post" }));

    expect(await screen.findByText("Line 3 has an amount but no account selected.")).toBeInTheDocument();
    expect(journalEntriesCreate).not.toHaveBeenCalled();
  });

  it("creates the draft then posts it, and clears the grid on full success", async () => {
    journalEntriesCreate.mockResolvedValue({
      id: "entry-1",
      journalId: "journal-gen",
      date: "2026-09-15",
      reference: undefined,
      state: "Draft",
      sequenceNumber: undefined,
      postedAtUtc: undefined,
      lines: [
        { id: "line-1", accountId: "acc-cash", partnerId: undefined, debit: 100, credit: 0, description: undefined },
        { id: "line-2", accountId: "acc-rev", partnerId: undefined, debit: 0, credit: 100, description: undefined },
      ],
    });
    post3.mockResolvedValue({});
    const onCreated = vi.fn();
    renderGrid(onCreated);
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const account0 = type(0, "Account", "100100");
    fireEvent.keyDown(account0, { key: "Tab" });
    const debit0 = type(0, "Debit", "100.00");
    fireEvent.keyDown(debit0, { key: "Enter" });

    const account1 = type(1, "Account", "400100");
    fireEvent.keyDown(account1, { key: "Tab" });
    const credit1 = type(1, "Credit", "100.00");
    fireEvent.keyDown(credit1, { key: "Enter" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Save and post" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save and post" }));

    // Password dialog appears — complete it to proceed with the actual create
    await completePasswordDialog();

    await waitFor(() => expect(journalEntriesCreate).toHaveBeenCalledTimes(1));
    // First arg is companyId, second is the action token, third is the request body
    expect(journalEntriesCreate.mock.calls[0][2].lines).toEqual([
      { accountId: "acc-cash", partnerId: undefined, debit: 100, credit: 0, description: undefined },
      { accountId: "acc-rev", partnerId: undefined, debit: 0, credit: 100, description: undefined },
    ]);
    await waitFor(() => expect(post3).toHaveBeenCalledWith("company-1", "entry-1"));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(cellInput(0, "Account")).toHaveValue("");
  });
});

describe("Debit/Credit inline validation", () => {
  it("shows an inline warning and disables Save when a line has both Debit and Credit positive", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const account0 = type(0, "Account", "100100");
    fireEvent.keyDown(account0, { key: "Tab" });
    const debit0 = type(0, "Debit", "100.00");
    fireEvent.keyDown(debit0, { key: "Tab" }); // commit debit, move to credit
    const credit0 = type(0, "Credit", "100.00");
    fireEvent.keyDown(credit0, { key: "Tab" }); // commit credit

    // Inline warning should appear
    await waitFor(() => expect(screen.getByText("Enter an amount in either Debit or Credit, not both.")).toBeInTheDocument());
    // Save should be disabled
    expect(screen.getByRole("button", { name: "Save and post" })).toBeDisabled();
  });

  it("removes the inline warning when the dual-amount is corrected", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const account0 = type(0, "Account", "100100");
    fireEvent.keyDown(account0, { key: "Tab" });
    const debit0 = type(0, "Debit", "100.00");
    fireEvent.keyDown(debit0, { key: "Tab" });
    type(0, "Credit", "50.00");
    fireEvent.keyDown(cellInput(0, "Credit"), { key: "Tab" });

    await waitFor(() => expect(screen.getByText("Enter an amount in either Debit or Credit, not both.")).toBeInTheDocument());

    // Clear the credit field to fix it
    type(0, "Credit", "");
    fireEvent.keyDown(cellInput(0, "Credit"), { key: "Tab" });

    await waitFor(() => expect(screen.queryByText("Enter an amount in either Debit or Credit, not both.")).not.toBeInTheDocument());
  });

  it("rejects negative values from sanitizeAmount — they never reach grid state", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    // Type a negative debit — sanitizeAmount should reject it and keep the previous value (empty)
    type(0, "Debit", "-100.00");
    fireEvent.keyDown(cellInput(0, "Debit"), { key: "Tab" });

    // The committed value should be empty (previous value), not -100.00
    expect(cellInput(0, "Debit")).toHaveValue("");
  });
});

describe("PickerCell dropdown behavior", () => {
  function renderGridWithPartners() {
    partnersAll.mockResolvedValue([
      { id: "partner-erion", name: "Erion LLC", taxNumber: "123456789", partnerType: 0 },
      { id: "partner-soloop", name: "Soloop Solutions", taxNumber: "987654321", partnerType: 0 },
    ]);
    projectsAll.mockResolvedValue([]);
    listEmployees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    actionTokens.mockResolvedValue({ token: "test-action-token", expiresAtUtc: new Date(Date.now() + 300_000).toISOString() });
    return render(
      <MemoryRouter>
        <IntlProviderWrapper>
          <JournalEntryGrid companyId="company-1" journals={JOURNALS} accounts={ACCOUNTS} onCreated={vi.fn()} />
        </IntlProviderWrapper>
      </MemoryRouter>,
    );
  }

  it("shows the dropdown when typing in an account cell and hides it after selecting an option", async () => {
    renderGridWithPartners();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const accountInput = type(0, "Account", "100");
    // Dropdown should appear with matching accounts
    await waitFor(() => expect(screen.getByText("100100 · Cash")).toBeInTheDocument());

    // Select via mousedown (the real path — onMouseDown, not onClick)
    fireEvent.mouseDown(screen.getByText("100100 · Cash"));

    // After selection, the dropdown should close (not show the selected item as a search result)
    await waitFor(() => expect(screen.queryByText("100100 · Cash")).not.toBeInTheDocument());
    expect(accountInput).toHaveValue("100100 · Cash");
  });

  it("shows the dropdown when typing in the partner cell and closes it after selection", async () => {
    renderGridWithPartners();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const partnerInput = type(0, "Partner", "Erion");
    await waitFor(() => expect(screen.getByText("Erion LLC")).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByText("Erion LLC"));

    // After selection, dropdown should be suppressed
    await waitFor(() => expect(screen.queryByText("Erion LLC")).not.toBeInTheDocument());
    expect(partnerInput).toHaveValue("Erion LLC");
  });

  it("reopens the dropdown when the user types new text after a selection", async () => {
    renderGridWithPartners();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const partnerInput = type(0, "Partner", "Erion");
    await waitFor(() => expect(screen.getByText("Erion LLC")).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText("Erion LLC"));
    await waitFor(() => expect(screen.queryByText("Erion LLC")).not.toBeInTheDocument());

    // User starts typing again — dropdown should reopen
    fireEvent.change(partnerInput, { target: { value: "Sol" } });
    await waitFor(() => expect(screen.getByText("Soloop Solutions")).toBeInTheDocument());
  });

  it("selects a dropdown option via keyboard (ArrowDown + Enter)", async () => {
    renderGridWithPartners();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const accountInput = type(0, "Account", "100");
    await waitFor(() => expect(screen.getByText("100100 · Cash")).toBeInTheDocument());

    // ArrowDown to highlight first option, then Enter to select
    fireEvent.keyDown(accountInput, { key: "ArrowDown" });
    fireEvent.keyDown(accountInput, { key: "Enter" });

    // Dropdown should close after keyboard selection
    await waitFor(() => expect(screen.queryByText("100100 · Cash")).not.toBeInTheDocument());
    expect(accountInput).toHaveValue("100100 · Cash");
  });
});

describe("F12 analytic distribution editor", () => {
  // journalEntriesCreate/post3 are module-scoped vi.fn()s shared with the keyboard-model suite
  // above, which already exercised them — clear call history so ".not.toHaveBeenCalled()" below
  // reflects only this test's own actions, not a prior test's.
  beforeEach(() => {
    journalEntriesCreate.mockClear();
    post3.mockClear();
    actionTokens.mockClear();
  });

  function balanceTwoAccountedLines() {
    const account0 = type(0, "Account", "100100");
    fireEvent.keyDown(account0, { key: "Tab" });
    const debit0 = type(0, "Debit", "100.00");
    fireEvent.keyDown(debit0, { key: "Enter" });

    const account1 = type(1, "Account", "400100");
    fireEvent.keyDown(account1, { key: "Tab" });
    const credit1 = type(1, "Credit", "100.00");
    fireEvent.keyDown(credit1, { key: "Enter" });
  }

  async function addAllocation(costCenterOptionIndex: number, percentage: string) {
    fireEvent.click(screen.getByRole("button", { name: "Add allocation" }));
    // Open the last cost center dropdown (the newly added one)
    const triggers = screen.getAllByLabelText("Cost center");
    const trigger = triggers[triggers.length - 1];
    fireEvent.click(trigger);
    // Options load asynchronously (fetchCostCenters) — wait until there are enough options
    // in the popover portal before picking the one at the requested index.
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(costCenterOptionIndex + 1));
    const options = screen.getAllByRole("option");
    fireEvent.mouseDown(options[costCenterOptionIndex]);
    const percentageInputs = screen.getAllByLabelText("Percentage");
    fireEvent.change(percentageInputs[percentageInputs.length - 1], { target: { value: percentage } });
  }

  it("does not block Save when a line's distribution is left unassigned (zero allocations is valid)", async () => {
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    balanceTwoAccountedLines();

    expect(screen.getByRole("button", { name: "Save and post" })).not.toBeDisabled();
  });

  it("blocks Save with a specific message while a line's distribution is a partial split, and unblocks once it sums to exactly 100%", async () => {
    journalEntriesCreate.mockResolvedValue({
      id: "entry-2",
      journalId: "journal-gen",
      date: "2026-09-15",
      reference: undefined,
      state: "Draft",
      sequenceNumber: undefined,
      postedAtUtc: undefined,
      lines: [
        { id: "line-1", accountId: "acc-cash", partnerId: undefined, debit: 100, credit: 0, description: undefined },
        { id: "line-2", accountId: "acc-rev", partnerId: undefined, debit: 0, credit: 100, description: undefined },
      ],
    });
    post3.mockResolvedValue({});
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    balanceTwoAccountedLines();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save and post" })).not.toBeDisabled());

    fireEvent.click(cellInput(0, "Analytic distribution"));
    await addAllocation(0, "60");
    await addAllocation(1, "20"); // sums to 80, short of 100
    expect(await screen.findByText("Total: 80.00%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "Save and post" }));
    expect(await screen.findByText("Line 1's analytic distribution must total exactly 100% (or be left empty).")).toBeInTheDocument();
    expect(journalEntriesCreate).not.toHaveBeenCalled();

    // Reopen and complete the split to exactly 100%.
    fireEvent.click(cellInput(0, "Analytic distribution"));
    const percentageInputs = await screen.findAllByLabelText("Percentage");
    fireEvent.change(percentageInputs[1], { target: { value: "40" } });
    expect(await screen.findByText("Total: 100.00%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "Save and post" }));

    // Password dialog appears — complete it to proceed
    await completePasswordDialog();

    await waitFor(() => expect(journalEntriesCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(post3).toHaveBeenCalledWith("company-1", "entry-2"));
  });
});
