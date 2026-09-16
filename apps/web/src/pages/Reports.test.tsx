import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CompanyResponse, FileResponse, ProfitAndLossResponse, SalesBookResponse } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Reports } from "@/pages/Reports";

// Regression test for the F10 bug found in code review: the lock badge (and the exported file's
// lock notice) must reflect the period the currently-displayed report was actually loaded for, not
// the live, possibly-edited-but-not-yet-submitted date inputs. Editing a date field after a
// successful load must not change the badge until "Run report" is clicked again.

const activeCompany: CompanyResponse = {
  id: "c1",
  name: "Test Co",
  firmId: undefined,
  accountingLockDate: "2026-08-31",
  taxLockDate: undefined,
  saleLockDate: undefined,
  purchaseLockDate: undefined,
  hardLockDate: undefined,
  enabledProfiles: 1,
  isVatRegistered: true,
  allowNumberOverride: false,
};

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [activeCompany],
    activeCompanyId: activeCompany.id,
    activeCompany,
    loading: false,
    error: null,
    setActiveCompanyId: vi.fn(),
    createCompany: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function pnlResponse(from: string, to: string): ProfitAndLossResponse {
  return { from, to, income: [], expenses: [], totalIncome: 0, totalExpenses: 0, netIncome: 0 };
}

const profitAndLoss = vi.fn(async (_companyId: string, from: string, to: string) => pnlResponse(from, to));

function salesBookResponse(from: string, to: string): SalesBookResponse {
  return {
    from,
    to,
    lines: [
      {
        invoiceId: "inv-1",
        invoiceNumber: "INV-0001",
        issueDate: to,
        documentType: "Invoice",
        partnerId: "p1",
        partnerName: "Acme Sh.p.k.",
        partnerTaxNumber: "600123456",
        partnerFiscalNumber: undefined,
        vatCode: "S18",
        rate: 0.18,
        netAmount: 100,
        vatAmount: 18,
        grossAmount: 118,
      },
    ],
    totalNet: 100,
    totalVat: 18,
    totalGross: 118,
  };
}

const salesBook = vi.fn(async (_companyId: string, from: string, to: string) => salesBookResponse(from, to));
const salesBookExport = vi.fn(async (companyId: string, from: string, to: string): Promise<FileResponse> => {
  void companyId;
  void from;
  void to;
  return { data: new Blob(["fake xlsx"]), status: 200, fileName: "sales-book.xlsx" };
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      profitAndLoss: (companyId: string, from: string, to: string) => profitAndLoss(companyId, from, to),
      salesBook: (companyId: string, from: string, to: string) => salesBook(companyId, from, to),
      salesBookExport: (companyId: string, from: string, to: string) => salesBookExport(companyId, from, to),
    },
  };
});

function renderPage() {
  return render(
    <IntlProviderWrapper>
      <Reports />
    </IntlProviderWrapper>,
  );
}

describe("Reports — lock badge reflects loaded data, not live inputs", () => {
  it("keeps showing the loaded period's lock status after the date input is edited without re-running", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-08-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));

    await waitFor(() => expect(profitAndLoss).toHaveBeenCalledWith("c1", expect.any(String), "2026-08-31"));
    await waitFor(() => expect(screen.getByText("Locked")).toBeInTheDocument());
    expect(screen.getByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();

    // Edit the date to an unlocked one WITHOUT clicking "Run report" again.
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-30" } });

    // The badge must still reflect the loaded (locked) period — not the edited, unsubmitted one.
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();

    // Running the report again for the new, unlocked period updates the badge.
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(profitAndLoss).toHaveBeenCalledWith("c1", expect.any(String), "2026-09-30"));
    await waitFor(() => expect(screen.queryByText("Locked")).not.toBeInTheDocument());
  });
});

describe("Reports — Sales Book tab", () => {
  let objectUrlCounter = 0;

  beforeAll(() => {
    // jsdom has no createObjectURL/revokeObjectURL — polyfill for the export button's download,
    // scoped to this test file only (same pattern as AttachmentsPanel.test.tsx). jsdom also logs a
    // "Not implemented: navigation" error when the download `<a>` is actually clicked (it tries to
    // navigate to the fake blob: URL) — stub `click()` itself so the test only proves the anchor
    // was built and invoked, not a real navigation.
    URL.createObjectURL = vi.fn(() => `blob:mock-${objectUrlCounter++}`);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("runs the real sales-book endpoint, renders the returned lines, and exports via the real export endpoint", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Sales Book" }));
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));

    await waitFor(() => expect(salesBook).toHaveBeenCalledWith("c1", expect.any(String), expect.any(String)));
    await waitFor(() => expect(screen.getByText("INV-0001")).toBeInTheDocument());
    expect(screen.getByText("Acme Sh.p.k.")).toBeInTheDocument();
    expect(screen.getByText("Total net: 100.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(salesBookExport).toHaveBeenCalled());
  });
});
