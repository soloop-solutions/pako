import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/balance-sheet-comparative.json";

import { renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  profitAndLoss: vi.fn(),
  balanceSheet: vi.fn(),
  comparative: vi.fn(),
  vatReturn: vi.fn(),
  debtAging: vi.fn(),
  salesBook: vi.fn(),
  purchaseBook: vi.fn(),
  partnersAll: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const pnl = { from: "2025-03-01", to: "2025-06-30", income: [], costOfRevenue: [], expenses: [], operatingExpenses: [], totalIncome: 1, totalCostOfRevenue: 1, totalExpenses: 1, totalOperatingExpenses: 1, grossProfit: 4242.42, netIncome: 1 };
const balanceSheet = { asOf: "2025-06-30", assets: [], liabilities: [], equity: [], currentEarnings: 0, totalAssets: 1000.1, totalLiabilities: 1, totalEquity: 1, totalLiabilitiesAndEquity: 777.77, difference: 222.33 };
const vat = { from: "2025-03-01", to: "2025-06-30", outputVat: [], inputVat: [], totalOutputVat: 1, totalInputVat: 1, netVatDue: 4242.42 };
const debt = { asOf: "2025-06-30", lines: [{ invoiceId: "i1", invoiceNumber: "INV-7777", partnerId: "p1", issueDate: "2025-05-01", dueDate: "2025-06-01", graceDays: 0, outstanding: 5, bucket: "Overdue" }], totalCurrent: 0, totalWithinGrace: 0, totalOverdue: 5 };
const salesBook = { from: "2025-03-01", to: "2025-06-30", lines: [{ invoiceId: "i1", invoiceNumber: "INV-SALES-1", issueDate: "2025-05-05", documentType: "Invoice", partnerId: "p1", partnerName: "Alba", vatCode: "S18", rate: 0.18, netAmount: 100, vatAmount: 18, grossAmount: 118 }], totalNet: 100, totalVat: 18, totalGross: 118 };
const purchaseBook = { from: "2025-03-01", to: "2025-06-30", lines: [{ billId: "b1", vendorReference: "VR-BOOK-1", issueDate: "2025-05-05", documentType: "Bill", partnerId: "p1", partnerName: "Prime", vatCode: "S18", rate: 0.18, netAmount: 100, vatAmount: 18, grossAmount: 118 }], totalNet: 100, totalVat: 18, totalGross: 118 };

interface Case {
  name: string;
  tab: string;
  fn: keyof typeof m;
  fixture: unknown;
  visible: string;
  inputs: Record<string, string>;
  args: unknown[];
  params: string[];
}

const RANGE = { From: "2025-03-01", To: "2025-06-30" };
const RANGE_PARAMS = ["from=2025-03-01", "to=2025-06-30"];
const CASES: Case[] = [
  { name: "P&L", tab: "pnl", fn: "profitAndLoss", fixture: pnl, visible: "Gross profit: 4242.42", inputs: RANGE, args: ["c1", "2025-03-01", "2025-06-30"], params: RANGE_PARAMS },
  { name: "VAT return", tab: "vat", fn: "vatReturn", fixture: vat, visible: "Net VAT due: 4242.42", inputs: RANGE, args: ["c1", "2025-03-01", "2025-06-30"], params: RANGE_PARAMS },
  { name: "sales book", tab: "sales-book", fn: "salesBook", fixture: salesBook, visible: "INV-SALES-1", inputs: RANGE, args: ["c1", "2025-03-01", "2025-06-30"], params: RANGE_PARAMS },
  { name: "purchase book", tab: "purchase-book", fn: "purchaseBook", fixture: purchaseBook, visible: "VR-BOOK-1", inputs: RANGE, args: ["c1", "2025-03-01", "2025-06-30"], params: RANGE_PARAMS },
  { name: "balance sheet", tab: "balance-sheet", fn: "balanceSheet", fixture: balanceSheet, visible: "Assets (1000.10) = Liabilities + Equity (777.77)", inputs: { "As of": "2025-06-30" }, args: ["c1", "2025-06-30"], params: ["asOf=2025-06-30"] },
  { name: "debt aging", tab: "debt", fn: "debtAging", fixture: debt, visible: "INV-7777", inputs: { "As of": "2025-06-30" }, args: ["c1", "2025-06-30"], params: ["asOf=2025-06-30"] },
];

const search = () => screen.getByTestId("location").textContent ?? "";

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.partnersAll.mockResolvedValue([{ id: "p1", name: "Alba" }]);
  m.checks.mockResolvedValue({ from: "2025-01-01", to: "2025-03-31", checks: [] });
});

describe.each(CASES)("$name keeps its period in the url", (c) => {
  beforeEach(() => m[c.fn].mockResolvedValue(c.fixture));

  it("runs on mount when the url carries the period, without clicking Run", async () => {
    const qs = c.params.join("&");
    renderReports(`/reports?tab=${c.tab}&${qs}`);
    expect(await screen.findByText(c.visible)).toBeInTheDocument();
    expect(m[c.fn]).toHaveBeenCalledWith(...c.args);
    for (const [label, value] of Object.entries(c.inputs)) expect(screen.getByLabelText(label)).toHaveValue(value);
  });

  it("does not run on mount when the url carries no period", async () => {
    renderReports(`/reports?tab=${c.tab}`);
    expect(await screen.findByRole("button", { name: "Run report" })).toBeEnabled();
    expect(m[c.fn]).not.toHaveBeenCalled();
  });

  it("Run writes the period to the url, and a remount with that url shows the data again", async () => {
    const first = renderReports(`/reports?tab=${c.tab}`);
    for (const [label, value] of Object.entries(c.inputs)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    expect(await screen.findByText(c.visible)).toBeInTheDocument();
    expect(m[c.fn]).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(search()).toContain(`tab=${c.tab}`));
    for (const p of c.params) expect(search()).toContain(p);
    const url = `/reports${search()}`;
    first.unmount();

    renderReports(url);
    expect(await screen.findByText(c.visible)).toBeInTheDocument();
    expect(m[c.fn]).toHaveBeenCalledTimes(2);
    expect(m[c.fn]).toHaveBeenLastCalledWith(...c.args);
  });
});

describe("balance sheet compare-to", () => {
  it("is kept in the url and restored", async () => {
    m.comparative.mockResolvedValue(fixture);
    renderReports("/reports?tab=balance-sheet&asOf=2025-06-30&compareTo=2024-06-30");
    await waitFor(() => expect(m.comparative).toHaveBeenCalledWith("c1", "2025-06-30", "2024-06-30"));
    expect(screen.getByLabelText("Compare to")).toHaveValue("2024-06-30");
    expect(m.balanceSheet).not.toHaveBeenCalled();
  });
});
