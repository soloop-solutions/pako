import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

import { JournalEntryDialog } from "./JournalEntryDialog";

vi.mock("@/lib/payroll-enums", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payroll-enums")>()),
  formatAmount: (v: number) => `FMT(${v})`,
}));

const ENTRY = {
  id: "e1",
  journalId: "j1",
  date: "2026-03-05",
  reference: "REF-9",
  remarks: "Rent",
  state: "Posted",
  lines: [{ id: "l1", accountId: "a1", debit: 120, credit: 0, description: "Rent" }],
};

function renderDialog(entry = ENTRY) {
  return render(
    <IntlProviderWrapper>
      <JournalEntryDialog entry={entry as never} accounts={[]} journals={[]} onClose={() => {}} />
    </IntlProviderWrapper>,
  );
}

describe("JournalEntryDialog", () => {
  beforeEach(() => localStorage.clear());

  it("shows the state through its translated label", () => {
    localStorage.setItem("pako.language", "sq");
    renderDialog();
    expect(screen.getByText("Postuar")).toBeInTheDocument();
    expect(screen.queryByText("Posted")).not.toBeInTheDocument();
  });

  it("falls back to the raw state when it has no label", () => {
    renderDialog({ ...ENTRY, state: "Reversed" });
    expect(screen.getByText("Reversed")).toBeInTheDocument();
  });

  it("formats amounts with the shared helper", () => {
    renderDialog();
    expect(screen.getByText("FMT(120)")).toBeInTheDocument();
    expect(screen.getByText("FMT(0)")).toBeInTheDocument();
  });
});
