import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import balanceSheetCompare from "@/mocks/balance-sheet-comparative.json";
import cashFlow from "@/mocks/cash-flow.json";
import equity from "@/mocks/equity-statement.json";
import monthly from "@/mocks/pnl-monthly.json";

import { renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  profitAndLoss: vi.fn(),
  balanceSheet: vi.fn(),
  comparative: vi.fn(),
  cashFlow: vi.fn(),
  equityStatement: vi.fn(),
  monthly: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const ACC = (code: string) => `5b1f0c2e-1a11-4c01-9a03-000000000${code}`;
const acc = (code: string) => `/chart-of-accounts?open=${ACC(code)}`;

const pnl = {
  from: "2026-01-01",
  to: "2026-12-31",
  income: [{ accountId: ACC("701"), accountCode: "701", accountName: "Revenue from sales", amount: 1000 }],
  costOfRevenue: [{ accountId: ACC("601"), accountCode: "601", accountName: "Cost of goods sold", amount: 400 }],
  operatingExpenses: [{ accountId: ACC("621"), accountCode: "621", accountName: "Rent", amount: 100 }],
  expenses: [],
  totalIncome: 1000,
  totalExpenses: 500,
  totalCostOfRevenue: 400,
  grossProfit: 600,
  totalOperatingExpenses: 100,
  netIncome: 500,
};

const balanceSheet = {
  asOf: "2026-12-31",
  assets: [{ accountId: ACC("120"), accountCode: "120", accountName: "Trade receivables", amount: 25000 }],
  liabilities: [{ accountId: ACC("400"), accountCode: "400", accountName: "Trade payables", amount: 20000 }],
  equity: [{ accountId: ACC("560"), accountCode: "560", accountName: "Retained earnings", amount: 5000 }],
  currentEarnings: 0,
  totalAssets: 25000,
  totalLiabilities: 20000,
  totalEquity: 5000,
  totalLiabilitiesAndEquity: 25000,
  difference: 0,
};

const route = () => screen.getByTestId("route").textContent;
const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-12-31", checks: [] });
  m.profitAndLoss.mockResolvedValue(pnl);
  m.balanceSheet.mockResolvedValue(balanceSheet);
  m.comparative.mockResolvedValue(balanceSheetCompare);
  m.cashFlow.mockResolvedValue(cashFlow);
  m.equityStatement.mockResolvedValue(equity);
  m.monthly.mockResolvedValue(monthly);
});

describe("account rows link to the account", () => {
  it("period P&L: income, cost of revenue and expense rows open the account, the amount keeps its trial-balance drill", async () => {
    renderReports("/reports?tab=pnl");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Revenue from sales");
    fireEvent.click(screen.getByText("Revenue from sales"));
    expect(route()).toBe(acc("701"));
  });

  it("period P&L: cost of revenue and operating expense rows", async () => {
    renderReports("/reports?tab=pnl");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Cost of goods sold");
    fireEvent.click(screen.getByText("Cost of goods sold"));
    expect(route()).toBe(acc("601"));
  });

  it("period P&L: operating expense row", async () => {
    renderReports("/reports?tab=pnl");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Rent");
    fireEvent.click(screen.getByText("Rent"));
    expect(route()).toBe(acc("621"));
  });

  it("period P&L: the amount link still goes to the trial balance by code, not the account", async () => {
    renderReports("/reports?tab=pnl");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Revenue from sales");
    fireEvent.click(within(rowOf("Revenue from sales")).getByText("1000.00"));
    expect(route()).toBe("/ledger?trialBalance.q=701");
  });

  it("balance sheet: asset, liability and equity rows open the account", async () => {
    renderReports("/reports?tab=balance-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Trade receivables");
    fireEvent.click(screen.getByText("Trade receivables"));
    expect(route()).toBe(acc("120"));
  });

  it("balance sheet: synthetic current earnings line with the empty guid is inert", async () => {
    m.balanceSheet.mockResolvedValue({
      ...balanceSheet,
      equity: [
        ...balanceSheet.equity,
        { accountId: "00000000-0000-0000-0000-000000000000", accountCode: "", accountName: "Synthetic earnings", amount: 100 },
      ],
    });
    renderReports("/reports?tab=balance-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Synthetic earnings");
    const before = route();
    fireEvent.click(screen.getByText("Synthetic earnings"));
    expect(route()).toBe(before);
    expect(route()).not.toContain("00000000-0000");
  });

  it("balance sheet: liability row", async () => {
    renderReports("/reports?tab=balance-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Trade payables");
    fireEvent.click(screen.getByText("Trade payables"));
    expect(route()).toBe(acc("400"));
  });

  it("balance sheet: the amount link goes to the trial balance by code", async () => {
    renderReports("/reports?tab=balance-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Trade receivables");
    fireEvent.click(within(rowOf("Trade receivables")).getByText("25000.00"));
    expect(route()).toBe("/ledger?trialBalance.q=120");
  });

  it("comparative balance sheet: account rows open the account, total rows are inert", async () => {
    renderReports("/reports?tab=balance-sheet");
    fireEvent.change(document.getElementById("bs-compare-to") as HTMLInputElement, { target: { value: "2025-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Fixed assets");
    fireEvent.click(screen.getByText("Fixed assets"));
    expect(route()).toBe(acc("210"));
  });

  it("comparative balance sheet: total rows are not clickable", async () => {
    renderReports("/reports?tab=balance-sheet");
    fireEvent.change(document.getElementById("bs-compare-to") as HTMLInputElement, { target: { value: "2025-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await screen.findByText("Fixed assets");
    const total = rowOf("Total assets");
    expect(total.className).not.toContain("cursor-pointer");
    const before = route();
    fireEvent.click(screen.getByText("Total assets"));
    fireEvent.keyDown(total, { key: "Enter" });
    expect(route()).toBe(before);
  });

  it("cash flow: line rows open the account; opening, net income and closing rows are inert", async () => {
    renderReports("/reports?tab=cash-flow&from=2026-01-01&to=2026-12-31");
    await screen.findByText("Trade receivables");
    fireEvent.click(screen.getByText("Trade receivables"));
    expect(route()).toBe(acc("120"));
  });

  it("cash flow: summary and net income rows are not clickable", async () => {
    renderReports("/reports?tab=cash-flow&from=2026-01-01&to=2026-12-31");
    await screen.findByText("Trade receivables");
    for (const label of ["Opening cash", "Net income", "Closing cash"]) {
      expect(rowOf(label).className).not.toContain("cursor-pointer");
    }
    const before = route();
    fireEvent.click(screen.getByText("Closing cash"));
    expect(route()).toBe(before);
  });

  it("equity statement: movement rows open the account, opening and closing rows are inert", async () => {
    renderReports("/reports?tab=equity&from=2026-01-01&to=2026-12-31");
    await screen.findByText("Retained earnings (dividends paid)");
    expect(rowOf("Opening equity").className).not.toContain("cursor-pointer");
    expect(rowOf("Closing equity").className).not.toContain("cursor-pointer");
    fireEvent.click(screen.getByText("Retained earnings (dividends paid)"));
    expect(route()).toBe(acc("560"));
  });

  it.each([
    ["Revenue from sales", "701"],
    ["Cost of goods sold", "601"],
    ["Rent", "621"],
  ])("monthly P&L: %s row opens the account", async (label, code) => {
    renderReports("/reports?tab=monthly-pnl&year=2026");
    await screen.findByText(label);
    fireEvent.click(screen.getByText(label));
    expect(route()).toBe(acc(code));
  });

  it("monthly P&L: total and profit rows are not clickable", async () => {
    renderReports("/reports?tab=monthly-pnl&year=2026");
    await screen.findByText("Revenue from sales");
    expect(rowOf("Gross profit").className).not.toContain("cursor-pointer");
    expect(rowOf("Net income").className).not.toContain("cursor-pointer");
    const before = route();
    fireEvent.click(screen.getByText("Net income"));
    expect(route()).toBe(before);
  });
});
