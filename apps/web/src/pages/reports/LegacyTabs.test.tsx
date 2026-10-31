import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  profitAndLoss: vi.fn(),
  profitAndLossExport: vi.fn(),
  balanceSheet: vi.fn(),
  balanceSheetExport: vi.fn(),
  balanceSheetComparativeExport: vi.fn(),
  vatReturn: vi.fn(),
  vatReturnExport: vi.fn(),
  debtAging: vi.fn(),
  debtAgingExport: vi.fn(),
  partnersAll: vi.fn(),
  checks: vi.fn(),
}));
const exportRows = vi.hoisted(() => vi.fn());

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});
vi.mock("@/components/data-grid/exportToExcel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/data-grid/exportToExcel")>()),
  exportRowsToExcel: exportRows,
}));

describe("legacy report tabs", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    localStorage.clear();
    Object.values(m).forEach((fn) => fn.mockReset());
    exportRows.mockReset();
    m.profitAndLossExport.mockResolvedValue(fileResponse("pnl.xlsx"));
    m.balanceSheetExport.mockResolvedValue(fileResponse("bs.xlsx"));
    m.balanceSheetComparativeExport.mockResolvedValue(fileResponse("bsc.xlsx"));
    m.vatReturnExport.mockResolvedValue(fileResponse("vat.xlsx"));
    m.partnersAll.mockResolvedValue([{ id: "p1", name: "Alba Trade SH.P.K." }]);
    m.checks.mockResolvedValue({ from: "2025-01-01", to: "2025-03-31", checks: [] });
  });

  it("P&L takes its period from the URL and exports from the server without running", async () => {
    renderReports("/reports?tab=pnl&from=2025-01-01&to=2025-03-31");
    expect(screen.getByLabelText("From")).toHaveValue("2025-01-01");
    expect(screen.getByLabelText("To")).toHaveValue("2025-03-31");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.profitAndLossExport).toHaveBeenCalledWith("c1", "2025-01-01", "2025-03-31"));
    expect(m.profitAndLoss).not.toHaveBeenCalled();
    expect(exportRows).not.toHaveBeenCalled();
  });

  it("VAT return takes its period from the URL and exports from the server without running", async () => {
    renderReports("/reports?tab=vat&from=2025-02-01&to=2025-02-28");
    expect(screen.getByLabelText("From")).toHaveValue("2025-02-01");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.vatReturnExport).toHaveBeenCalledWith("c1", "2025-02-01", "2025-02-28"));
    expect(exportRows).not.toHaveBeenCalled();
  });

  it("balance sheet exports the plain sheet from the server, or the comparative when compare-to is set", async () => {
    renderReports("/reports?tab=balance-sheet&asOf=2025-12-31");
    expect(screen.getByLabelText("As of")).toHaveValue("2025-12-31");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.balanceSheetExport).toHaveBeenCalledWith("c1", "2025-12-31"));
    fireEvent.change(screen.getByLabelText("Compare to"), { target: { value: "2024-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.balanceSheetComparativeExport).toHaveBeenCalledWith("c1", "2025-12-31", "2024-12-31"));
    expect(exportRows).not.toHaveBeenCalled();
  });

  it("debt export comes from the server endpoint with the loaded as-of date", async () => {
    m.debtAging.mockResolvedValue({
      asOf: "2025-12-31",
      lines: [
        { invoiceId: "i1", invoiceNumber: "INV-0001", partnerId: "p1", issueDate: "2025-11-01", dueDate: "2025-12-01", graceDays: 0, outstanding: 1180, bucket: "Overdue" },
      ],
      totalCurrent: 0,
      totalWithinGrace: 0,
      totalOverdue: 1180,
    });
    m.debtAgingExport.mockResolvedValue(fileResponse("debt.xlsx"));
    renderReports("/reports?tab=debt&asOf=2025-12-31");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("INV-0001");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.debtAgingExport).toHaveBeenCalledWith("c1", "2025-12-31"));
    expect(exportRows).not.toHaveBeenCalled();
  });

  it("sales book takes its period from the URL", () => {
    renderReports("/reports?tab=sales-book&from=2025-04-01&to=2025-04-30");
    expect(screen.getByLabelText("From")).toHaveValue("2025-04-01");
    expect(screen.getByLabelText("To")).toHaveValue("2025-04-30");
  });

  it("purchase book takes its period from the URL", () => {
    renderReports("/reports?tab=purchase-book&from=2025-05-01&to=2025-05-31");
    expect(screen.getByLabelText("From")).toHaveValue("2025-05-01");
    expect(screen.getByLabelText("To")).toHaveValue("2025-05-31");
  });
  it("P&L shows the cost of revenue lines and the server gross profit without recomputing", async () => {
    m.profitAndLoss.mockResolvedValue({
      from: "2025-01-01",
      to: "2025-03-31",
      income: [{ accountId: "a1", accountCode: "7000", accountName: "Sales revenue", amount: 5000 }],
      costOfRevenue: [{ accountId: "a2", accountCode: "5000", accountName: "Cost of Goods Sold", amount: 1234.56 }],
      expenses: [
        { accountId: "a2", accountCode: "5000", accountName: "Cost of Goods Sold", amount: 1234.56 },
        { accountId: "a3", accountCode: "6000", accountName: "Rent", amount: 800 },
      ],
      totalIncome: 5000,
      totalCostOfRevenue: 1234.56,
      totalExpenses: 2034.56,
      operatingExpenses: [{ accountId: "a3", accountCode: "6000", accountName: "Rent", amount: 800 }],
      totalOperatingExpenses: 800,
      grossProfit: 3333.33,
      netIncome: 2965.44,
    });
    renderReports("/reports?tab=pnl&from=2025-01-01&to=2025-03-31");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    const cost = await screen.findByTestId("pnl-cost-of-revenue");
    expect(within(cost).getByText("Cost of Goods Sold")).toBeInTheDocument();
    expect(within(cost).getByText("1234.56")).toBeInTheDocument();
    expect(screen.getByText("Gross profit: 3333.33")).toBeInTheDocument();
    expect(screen.getByText("Total cost of revenue: 1234.56")).toBeInTheDocument();
    expect(screen.getByText("Operating expenses")).toBeInTheDocument();
    expect(screen.getByText("Rent")).toBeInTheDocument();
    expect(screen.getByText("Total operating expenses: 800.00")).toBeInTheDocument();
    expect(screen.queryByText("Total expenses: 2034.56")).not.toBeInTheDocument();
    expect(screen.getByText("Net income: 2965.44")).toBeInTheDocument();
  });
});
