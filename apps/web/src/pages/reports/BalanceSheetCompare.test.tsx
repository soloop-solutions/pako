import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/balance-sheet-comparative.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  balanceSheet: vi.fn(),
  comparative: vi.fn(),
  balanceSheetComparativeExport: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

describe("BalanceSheetTab compare-to", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.comparative.mockResolvedValue(fixture);
    m.balanceSheet.mockResolvedValue({
      asOf: "2026-12-31", assets: [], liabilities: [], equity: [], currentEarnings: 0,
      totalAssets: 0, totalLiabilities: 0, totalEquity: 0, totalLiabilitiesAndEquity: 0, difference: 0,
    });
    m.balanceSheetComparativeExport.mockResolvedValue(fileResponse("bsc.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-12-31", checks: [] });
  });

  it("without compare-to uses the plain endpoint", async () => {
    renderReports("/reports");
    fireEvent.click(screen.getByRole("button", { name: "Balance Sheet" }));
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(m.balanceSheet).toHaveBeenCalled());
    expect(m.comparative).not.toHaveBeenCalled();
  });

  it("shows the server balance equation without summing in the browser", async () => {
    m.balanceSheet.mockResolvedValue({
      asOf: "2026-12-31", assets: [], liabilities: [], equity: [], currentEarnings: 0,
      totalAssets: 1000.1, totalLiabilities: 400.05, totalEquity: 590, totalLiabilitiesAndEquity: 777.77, difference: 222.33,
    });
    renderReports("/reports");
    fireEvent.click(screen.getByRole("button", { name: "Balance Sheet" }));
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    const line = await screen.findByText("Assets (1000.10) = Liabilities + Equity (777.77)");
    expect(line).toHaveClass("text-destructive");
  });

  it("does not flag a balanced sheet", async () => {
    m.balanceSheet.mockResolvedValue({
      asOf: "2026-12-31", assets: [], liabilities: [], equity: [], currentEarnings: 0,
      totalAssets: 1000, totalLiabilities: 400, totalEquity: 600, totalLiabilitiesAndEquity: 1000, difference: 0,
    });
    renderReports("/reports");
    fireEvent.click(screen.getByRole("button", { name: "Balance Sheet" }));
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    const line = await screen.findByText("Assets (1000.00) = Liabilities + Equity (1000.00)");
    expect(line).not.toHaveClass("text-destructive");
  });

  it("with compare-to renders Current, Prior and Difference and exports comparatively", async () => {
    renderReports("/reports");
    fireEvent.click(screen.getByRole("button", { name: "Balance Sheet" }));
    fireEvent.change(screen.getByLabelText("As of"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("Compare to"), { target: { value: "2025-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(m.comparative).toHaveBeenCalledWith("c1", "2026-12-31", "2025-12-31"));
    expect(await screen.findByText("Cash and bank")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Current" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "Prior" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "Difference" }).length).toBeGreaterThan(0);
    const row = screen.getByText("Cash and bank").closest("tr") as HTMLElement;
    expect(within(row).getByText("45000.00")).toBeInTheDocument();
    expect(within(row).getByText("30000.00")).toBeInTheDocument();
    expect(within(row).getByText("15000.00")).toBeInTheDocument();

    const assets = screen.getByText("Total assets").closest("tr") as HTMLElement;
    expect(within(assets).getByText("130000.00")).toBeInTheDocument();
    expect(within(assets).getByText("100000.00")).toBeInTheDocument();
    expect(within(assets).getByText("30000.00")).toBeInTheDocument();
    const liabilities = screen.getByText("Total liabilities").closest("tr") as HTMLElement;
    expect(within(liabilities).getByText("60000.00")).toBeInTheDocument();
    expect(within(liabilities).getByText("55000.00")).toBeInTheDocument();
    expect(within(liabilities).getByText("5000.00")).toBeInTheDocument();
    const equity = screen.getByText("Total equity").closest("tr") as HTMLElement;
    expect(within(equity).getByText("70000.00")).toBeInTheDocument();
    expect(within(equity).getByText("45000.00")).toBeInTheDocument();
    expect(within(equity).getByText("25000.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.balanceSheetComparativeExport).toHaveBeenCalledWith("c1", "2026-12-31", "2025-12-31"));
  });
});
