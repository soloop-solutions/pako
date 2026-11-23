import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

import { JournalEntryDialog } from "./JournalEntryDialog";

const m = vi.hoisted(() => ({ journalEntryDetail: vi.fn() }));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <IntlProviderWrapper>
          <JournalEntryDialog companyId="c1" entry={entry as never} accounts={[]} journals={[]} onClose={() => {}} />
        </IntlProviderWrapper>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("JournalEntryDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    m.journalEntryDetail.mockReset();
    m.journalEntryDetail.mockResolvedValue({ ...ENTRY, sourceKind: "JournalEntry", sourceId: "e1", sourceDocument: null });
  });

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

  it("shows the source document with partner link, lines, totals and a link to the document", async () => {
    m.journalEntryDetail.mockResolvedValue({
      ...ENTRY,
      remarks: "Company note",
      sourceKind: "Invoice",
      sourceId: "inv1",
      sourceDocument: {
        kind: "Invoice",
        id: "inv1",
        documentNumber: "INV-0042",
        date: "2026-03-04",
        partnerId: "p1",
        partnerName: "Acme Sh.p.k.",
        notes: "Deliver Monday",
        lines: [{ description: "Widget", quantity: 3, unitPrice: 10, discountPercent: 0, netAmount: 30, taxAmount: 5.4, grossAmount: 35.4 }],
        netAmount: 30,
        taxAmount: 5.4,
        grossAmount: 35.4,
      },
    });
    renderDialog();
    const section = await screen.findByTestId("journal-source-document");
    expect(within(section).getByText("Source document")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "INV-0042" })).toHaveAttribute("href", "/invoicing/inv1");
    expect(within(section).getByRole("link", { name: "Acme Sh.p.k." })).toHaveAttribute("href", "/customers?open=p1");
    expect(within(section).getByRole("link", { name: "Open document" })).toHaveAttribute("href", "/invoicing/inv1");
    expect(within(section).getByText("Deliver Monday")).toBeInTheDocument();
    expect(within(section).getByText("Widget")).toBeInTheDocument();
    expect(within(section).getAllByText("FMT(35.4)")).toHaveLength(2);
    expect(await screen.findByText("Company note")).toBeInTheDocument();
    expect(m.journalEntryDetail).toHaveBeenCalledWith("c1", "e1");
  });

  it("shows only remarks for a manual entry", async () => {
    m.journalEntryDetail.mockResolvedValue({ ...ENTRY, remarks: "Manual note", sourceKind: "JournalEntry", sourceId: "e1" });
    renderDialog();
    expect(await screen.findByText("Manual note")).toBeInTheDocument();
    expect(screen.queryByTestId("journal-source-document")).not.toBeInTheDocument();
  });
});
