import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AccountResponse, JournalResponse } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { JournalEntryGrid } from "@/pages/ledger/JournalEntryGrid";

// Same technique src/pages/partners/Partners.test.tsx already established: the real backend isn't
// running inside vitest, so apiClient's network methods are mocked directly rather than via msw —
// but the cost-center picker's own mock (src/mocks/costCentersHandlers.ts) genuinely round-trips
// through the real msw/node server wired up in src/test/setup.ts, same as ChartOfAccounts.test.tsx.
const partnersAll = vi.fn();
const journalEntriesCreate = vi.fn();
const post3 = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      partnersAll: (...args: unknown[]) => partnersAll(...args),
      journalEntries: (...args: unknown[]) => journalEntriesCreate(...args),
      post3: (...args: unknown[]) => post3(...args),
    },
  };
});

const ACCOUNTS: AccountResponse[] = [
  { id: "acc-cash", code: "100100", name: "Cash", accountType: 0, accountSubType: 4, parentAccountId: undefined, isReconcilable: false },
  { id: "acc-rev", code: "400100", name: "Sales Revenue", accountType: 3, accountSubType: 0, parentAccountId: undefined, isReconcilable: false },
];

const JOURNALS: JournalResponse[] = [
  { id: "journal-gen", type: 0, code: "GEN", name: "General", sequencePrefix: "GEN", sequenceNextNumber: 1, sequencePadding: 4 },
];

function renderGrid(onCreated = vi.fn()) {
  partnersAll.mockResolvedValue([]);
  return {
    onCreated,
    ...render(
      <IntlProviderWrapper>
        <JournalEntryGrid companyId="company-1" journals={JOURNALS} accounts={ACCOUNTS} onCreated={onCreated} />
      </IntlProviderWrapper>,
    ),
  };
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

    const partnerCell = focusCell(1, "Partner"); // second-to-last column on the last (second) row
    fireEvent.keyDown(partnerCell, { key: "Tab" });

    // Moves right to the mocked cost-center column, same row (not yet a wrap — it's the last column).
    const costCenterCell = cellInput(1, "Cost center (mocked — not yet saved to the backend)");
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
    renderGrid();
    await waitFor(() => expect(partnersAll).toHaveBeenCalled());

    const account0 = type(0, "Account", "100100");
    fireEvent.keyDown(account0, { key: "Tab" });
    const debit = type(0, "Debit", "100.00");
    fireEvent.keyDown(debit, { key: "Enter" }); // moves to row 2's Debit, same column

    // Row 2 needs an account too — auto-balance below will only count its line if it has one.
    const account1 = type(1, "Account", "400100");
    fireEvent.keyDown(account1, { key: "Tab" });

    expect(await screen.findByText("Difference: 100.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and post" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Auto-balance last line" }));

    await waitFor(() => expect(cellInput(1, "Credit")).toHaveValue("100.00"));
    expect(screen.getByRole("button", { name: "Save and post" })).not.toBeDisabled();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });

  it("does not count a line's amount toward the totals or let Save through when that line has no account", async () => {
    renderGrid();
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

    expect(await screen.findByText("Difference: 40.00")).toBeInTheDocument();
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
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

    await waitFor(() => expect(journalEntriesCreate).toHaveBeenCalledTimes(1));
    expect(journalEntriesCreate.mock.calls[0][1].lines).toEqual([
      { accountId: "acc-cash", partnerId: undefined, debit: 100, credit: 0, description: undefined },
      { accountId: "acc-rev", partnerId: undefined, debit: 0, credit: 100, description: undefined },
    ]);
    await waitFor(() => expect(post3).toHaveBeenCalledWith("company-1", "entry-1"));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(cellInput(0, "Account")).toHaveValue("");
  });
});
