import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import expenseBook from "@/mocks/expense-book.json";
import generalLedger from "@/mocks/general-ledger.json";
import payablesAging from "@/mocks/payables-aging.json";
import purchaseTransactions from "@/mocks/purchase-transactions.json";
import vendorStatement from "@/mocks/vendor-statement.json";
import vendorSynthetic from "@/mocks/vendor-synthetic.json";

import { renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  generalLedger: vi.fn(),
  accountsAll: vi.fn(),
  partnersAll: vi.fn(),
  expenseBook: vi.fn(),
  vendorSynthetic: vi.fn(),
  vendorStatement: vi.fn(),
  salesBook: vi.fn(),
  purchaseBook: vi.fn(),
  debtAging: vi.fn(),
  payablesAging: vi.fn(),
  purchaseTransactions: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const route = () => screen.getByTestId("route").textContent;
const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

const INVOICE = "5b1f0c2e-1a11-4c01-9a06-000000000001";
const ACC_AR = "5b1f0c2e-1a11-4c01-9a03-000000000120";
const ALBA = "5b1f0c2e-1a11-4c01-9a02-000000000001";
const PRIME = "5b1f0c2e-1a11-4c01-9a04-000000000001";
const BILL1 = "5b1f0c2e-1a11-4c01-9a05-000000000001";
const ENTRY_MANUAL = "5b1f0c2e-1a11-4c01-9a01-000000000012";
const PAY_ENTRY = "5b1f0c2e-1a11-4c01-9a01-000000000021";

const salesBook = {
  from: "2026-01-01",
  to: "2026-01-31",
  lines: [
    { invoiceId: INVOICE, invoiceNumber: "INV-0001", issueDate: "2026-01-05", documentType: "Invoice", partnerId: ALBA, partnerName: "Alba Trade SH.P.K.", partnerTaxNumber: undefined, partnerFiscalNumber: undefined, vatCode: "S18", rate: 0.18, netAmount: 100, vatAmount: 18, grossAmount: 118, sourceKind: "Invoice", sourceId: INVOICE },
    { invoiceId: "x", invoiceNumber: "INV-NOLINK", issueDate: "2026-01-06", documentType: "Invoice", partnerId: "", partnerName: "No Id Ltd", partnerTaxNumber: undefined, partnerFiscalNumber: undefined, vatCode: "S18", rate: 0.18, netAmount: 1, vatAmount: 0, grossAmount: 1 },
  ],
  totalNet: 101,
  totalVat: 18,
  totalGross: 119,
};

const purchaseBook = {
  from: "2026-01-01",
  to: "2026-01-31",
  lines: [
    { billId: BILL1, vendorReference: "VR-1", issueDate: "2026-01-02", documentType: "Bill", partnerId: PRIME, partnerName: "Prime Properties L.L.C.", partnerTaxNumber: undefined, partnerFiscalNumber: undefined, vatCode: "S18", rate: 0.18, netAmount: 1000, vatAmount: 180, grossAmount: 1180, sourceKind: "Bill", sourceId: BILL1 },
  ],
  totalNet: 1000,
  totalVat: 180,
  totalGross: 1180,
};

const debt = {
  asOf: "2026-01-31",
  lines: [
    { invoiceId: INVOICE, invoiceNumber: "INV-0001", partnerId: ALBA, issueDate: "2026-01-01", dueDate: "2026-01-20", graceDays: 0, outstanding: 1180, bucket: "Overdue", sourceKind: "Invoice", sourceId: INVOICE },
  ],
  totalCurrent: 0,
  totalWithinGrace: 0,
  totalOverdue: 1180,
};

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-01-31", checks: [] });
  m.generalLedger.mockResolvedValue(generalLedger);
  m.accountsAll.mockResolvedValue([]);
  m.partnersAll.mockResolvedValue([{ id: ALBA, name: "Alba Trade SH.P.K." }]);
  m.expenseBook.mockResolvedValue(expenseBook);
  m.vendorSynthetic.mockResolvedValue(vendorSynthetic);
  m.vendorStatement.mockResolvedValue(vendorStatement);
  m.salesBook.mockResolvedValue(salesBook);
  m.purchaseBook.mockResolvedValue(purchaseBook);
  m.debtAging.mockResolvedValue(debt);
  m.payablesAging.mockResolvedValue(payablesAging);
  m.purchaseTransactions.mockResolvedValue(purchaseTransactions);
});

const GL = "/reports?tab=general-ledger&from=2026-01-01&to=2026-01-31";
const EB = "/reports?tab=expense-book&from=2026-01-01&to=2026-01-31";

describe("general ledger", () => {
  it("the account name cell of a revenue line opens that account", async () => {
    renderReports(GL);
    fireEvent.click((await screen.findAllByText("Revenue from sales"))[0]);
    expect(route()).toBe("/chart-of-accounts?open=5b1f0c2e-1a11-4c01-9a03-000000000701");
  });

  it("clicking a non-link cell opens the source invoice", async () => {
    renderReports(GL);
    fireEvent.click((await screen.findAllByText("JE-2026-0001"))[0]);
    expect(route()).toBe(`/invoicing/${INVOICE}`);
  });

  it("the account cell opens the account and not the invoice", async () => {
    renderReports(GL);
    fireEvent.click(await screen.findByText("Trade receivables"));
    expect(route()).toBe(`/chart-of-accounts?open=${ACC_AR}`);
  });

  it("the partner cell opens the partner and not the invoice", async () => {
    renderReports(GL);
    fireEvent.click(await screen.findByText("Alba Trade SH.P.K.", { selector: "a" }));
    expect(route()).toBe(`/partners?open=${ALBA}`);
  });

  it("a manual journal line opens the entry", async () => {
    m.generalLedger.mockResolvedValue({
      ...generalLedger,
      items: [{ ...generalLedger.items[0], entryNumber: "JE-MANUAL", sourceKind: "JournalEntry", sourceId: ENTRY_MANUAL }],
    });
    renderReports(GL);
    fireEvent.click(await screen.findByText("JE-MANUAL"));
    expect(route()).toBe(`/ledger?entry=${ENTRY_MANUAL}`);
  });

  it("a line without a source stays inert and the total row is not clickable", async () => {
    m.generalLedger.mockResolvedValue({
      ...generalLedger,
      items: [{ ...generalLedger.items[0], entryNumber: "JE-NOSRC", sourceKind: undefined, sourceId: undefined }],
    });
    renderReports(GL);
    const cell = await screen.findByText("JE-NOSRC");
    const row = cell.closest("tr") as HTMLElement;
    expect(row.className).not.toContain("cursor-pointer");
    const before = route();
    fireEvent.click(cell);
    expect(route()).toBe(before);
    expect(rowOf("Total").className).not.toContain("cursor-pointer");
  });
});

describe("expense book", () => {
  it("a bill row opens the bill", async () => {
    renderReports(EB);
    fireEvent.click(await screen.findByText("BILL-0001"));
    expect(route()).toBe(`/bills/${BILL1}`);
  });

  it("a manual row opens the journal entry", async () => {
    renderReports(EB);
    await screen.findByText("BILL-0001");
    const manual = screen.getAllByRole("row").find((r) => r.textContent?.includes("2026-01-31")) as HTMLElement;
    fireEvent.click(within(manual).getByText("2026-01-31"));
    expect(route()).toBe(`/ledger?entry=${ENTRY_MANUAL}`);
  });

  it("the partner cell opens the vendor, not the bill", async () => {
    renderReports(EB);
    fireEvent.click(await screen.findByText("Prime Properties L.L.C."));
    expect(route()).toBe(`/vendors?open=${PRIME}`);
  });

  it("the totals row is not clickable", async () => {
    renderReports(EB);
    await screen.findByText("BILL-0001");
    const footer = document.querySelector("tfoot tr") as HTMLElement;
    expect(footer.className).not.toContain("cursor-pointer");
    const before = route();
    fireEvent.click(footer);
    expect(route()).toBe(before);
  });
});

describe("vendor statement drawer", () => {
  const URL_ = `/reports?tab=vendors&from=2026-01-01&to=2026-01-31&vendor=${PRIME}`;

  it("a bill row opens the bill", async () => {
    renderReports(URL_);
    fireEvent.click(await screen.findByText("Office rent January 2026"));
    expect(route()).toContain(`/bills/${BILL1}`);
  });

  it("a payment row opens the journal entry", async () => {
    renderReports(URL_);
    fireEvent.click(await screen.findByText("Bank transfer"));
    expect(route()).toContain(`/ledger?entry=${PAY_ENTRY}`);
  });

  it("opening and closing rows are not clickable", async () => {
    renderReports(URL_);
    await screen.findByText("Bank transfer");
    const dialog = within(screen.getByRole("dialog"));
    for (const label of ["Opening balance", "Closing balance"]) {
      expect((dialog.getByText(label).closest("tr") as HTMLElement).className).not.toContain("cursor-pointer");
    }
  });
});

describe("sales and purchase books and debt aging", () => {
  async function run(url: string) {
    renderReports(url);
  }

  it("sales book: row opens the invoice", async () => {
    await run("/reports?tab=sales-book&from=2026-01-01&to=2026-01-31");
    await screen.findByText("INV-0001");
    fireEvent.click(screen.getAllByText("S18")[0]);
    expect(route()).toBe(`/invoicing/${INVOICE}`);
  });

  it("sales book: partner cell opens the customer and not the invoice", async () => {
    await run("/reports?tab=sales-book&from=2026-01-01&to=2026-01-31");
    fireEvent.click(await screen.findByText("Alba Trade SH.P.K."));
    expect(route()).toBe(`/customers?open=${ALBA}`);
  });

  it("sales book: a row without a source is inert", async () => {
    await run("/reports?tab=sales-book&from=2026-01-01&to=2026-01-31");
    const cell = await screen.findByText("INV-NOLINK");
    expect((cell.closest("tr") as HTMLElement).className).not.toContain("cursor-pointer");
    const before = route();
    fireEvent.click(cell);
    expect(route()).toBe(before);
  });

  it("purchase book: row opens the bill, partner opens the vendor", async () => {
    await run("/reports?tab=purchase-book&from=2026-01-01&to=2026-01-31");
    await screen.findByText("VR-1");
    fireEvent.click(screen.getByText("VR-1"));
    expect(route()).toBe(`/bills/${BILL1}`);
  });

  it("purchase book: partner cell opens the vendor", async () => {
    await run("/reports?tab=purchase-book&from=2026-01-01&to=2026-01-31");
    fireEvent.click(await screen.findByText("Prime Properties L.L.C."));
    expect(route()).toBe(`/vendors?open=${PRIME}`);
  });

  it("debt aging: row opens the invoice", async () => {
    await run("/reports?tab=debt&asOf=2026-01-31");
    fireEvent.click(await screen.findByText("INV-0001"));
    expect(route()).toBe(`/invoicing/${INVOICE}`);
  });

  it("debt aging: customer cell opens the customer", async () => {
    await run("/reports?tab=debt&asOf=2026-01-31");
    fireEvent.click(await screen.findByText("Alba Trade SH.P.K."));
    expect(route()).toBe(`/customers?open=${ALBA}`);
  });
});

describe("payables aging per bill and purchase transactions", () => {
  it("per-bill row opens the bill", async () => {
    renderReports("/reports?tab=payables-aging&asOf=2026-01-31");
    fireEvent.click(await screen.findByText("BILL-0001"));
    expect(route()).toBe(`/bills/${BILL1}`);
  });

  it("per-bill vendor cell opens the vendor and not the bill", async () => {
    renderReports("/reports?tab=payables-aging&asOf=2026-01-31");
    fireEvent.click(await screen.findByText("Prime Properties L.L.C."));
    expect(route()).toBe(`/vendors?open=${PRIME}`);
  });

  const TX = "/reports?tab=purchases&view=transactions&from=2026-01-01&to=2026-01-31";

  it("transactions: row opens the document", async () => {
    renderReports(TX);
    fireEvent.click(await screen.findByText("Office rent January 2026"));
    expect(route()).toBe(`/bills/${BILL1}`);
  });

  it("transactions: vendor cell opens the vendor", async () => {
    renderReports(TX);
    fireEvent.click(await screen.findByText("Prime Properties L.L.C.", { selector: "a" }));
    expect(route()).toBe(`/vendors?open=${PRIME}`);
  });

  it("transactions: item code cell opens the item, a free-text line has no item link", async () => {
    renderReports(TX);
    const code = await screen.findByText("ITM-0007");
    expect(code.tagName).toBe("A");
    fireEvent.click(code);
    expect(route()).toBe("/items?open=5b1f0c2e-1a11-4c01-9a07-000000000007");
  });

  it("transactions: the totals row is not clickable", async () => {
    renderReports(TX);
    await screen.findByText("Office rent January 2026");
    const footer = document.querySelector("tfoot tr") as HTMLElement;
    expect(footer.className).not.toContain("cursor-pointer");
  });
});
