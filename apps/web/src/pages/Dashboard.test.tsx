import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardLayoutResponse, DashboardResponse, DashboardWidgetConfig } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Dashboard } from "@/pages/Dashboard";

const company = { id: "c1", name: "Dash Co" };
const point = (start: string, revenue: number, expenses: number) => ({
  start, end: start, revenue, expenses, netProfit: revenue - expenses, cashBalance: 1000, payrollCost: 0,
});

let sections = { finance: true, sales: true, purchases: true, payroll: false, hr: false };
const data = (): DashboardResponse => ({
  from: "2026-10-01",
  to: "2026-10-31",
  compareFrom: "2025-10-01",
  compareTo: "2025-10-31",
  granularity: "week",
  sections,
  kpis: [
    { key: "revenue", current: 2000, previous: 1000, changePercent: 100, trend: [500, 700, 800] },
    { key: "netProfit", current: 500, previous: 600, changePercent: -16.7, trend: [100, 200, 200] },
    { key: "cash", current: 1000, previous: 900, changePercent: 11.1, trend: [1000, 1000, 1000] },
    { key: "overdueReceivables", current: 750, previous: undefined, changePercent: undefined, trend: [] },
  ],
  series: [point("2026-10-01", 500, 400), point("2026-10-08", 700, 500), point("2026-10-15", 800, 600)],
  compareSeries: [point("2025-10-01", 300, 300), point("2025-10-08", 300, 300), point("2025-10-15", 400, 300)],
  revenueByAccount: [],
  expensesByAccount: [{ id: "a1", name: "6000 Rent", current: 900, previous: 800 }],
  topCustomers: [{ id: "p1", name: "Customer Co", current: 1500, previous: 700 }, { id: undefined, name: "__other", current: 500, previous: 300 }],
  topVendors: [],
  topItems: [],
  receivablesAging: [],
  payablesAging: [],
  headcountByDepartment: [],
});

const layout: DashboardLayoutResponse = {
  widgets: [
    { key: "kpi.revenue", visual: "sparkline", size: 1, showComparison: true },
    { key: "kpi.netProfit", visual: "tile", size: 1, showComparison: true },
    { key: "revenueVsExpenses", visual: "column", size: 4, showComparison: false },
    { key: "topCustomers", visual: "bar", size: 2, showComparison: true },
    { key: "payrollTrend", visual: "column", size: 2, showComparison: true },
  ],
  isDefault: true,
  canEdit: true,
  updatedAt: undefined,
};

const getDashboard = vi.fn<(...args: unknown[]) => Promise<DashboardResponse>>(async () => data());
const saveLayout = vi.fn(async (_c: string, body: { widgets: DashboardWidgetConfig[] }) => ({ ...layout, widgets: body.widgets, isDefault: false }));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getDashboard: (...args: unknown[]) => getDashboard(...args),
      getDashboardLayout: async () => layout,
      saveDashboardLayout: (c: string, body: { widgets: DashboardWidgetConfig[] }) => saveLayout(c, body),
      resetDashboardLayout: async () => layout,
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ companies: [company], activeCompanyId: company.id, activeCompany: company, loading: false, error: null }),
}));

function renderDashboard(url = "/?period=month&anchor=2026-10") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Dashboard", () => {
  beforeEach(() => {
    sections = { finance: true, sales: true, purchases: true, payroll: false, hr: false };
    getDashboard.mockClear();
    saveLayout.mockClear();
  });

  it("asks for the period in the URL compared with last year, and shows figures with their change", async () => {
    renderDashboard();
    const revenue = await screen.findByText("Revenue", { selector: "[data-widget='kpi.revenue'] *" });
    const tile = revenue.closest("[data-widget]") as HTMLElement;
    expect(within(tile).getByText("2,000.00")).toBeInTheDocument();
    expect(within(tile).getByText("+100%")).toBeInTheDocument();
    expect(getDashboard).toHaveBeenCalledWith("c1", "2026-10-01", "2026-10-31", "2025-10-01", "2025-10-31", undefined);

    // Ranked bars name the folded row and keep the API's values.
    expect(screen.getByText("Customer Co")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    // A widget for an area the user can't see is left out.
    expect(document.querySelector("[data-widget='payrollTrend']")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Year" }));
    await waitFor(() =>
      expect(getDashboard).toHaveBeenLastCalledWith("c1", "2026-01-01", "2026-12-31", "2025-01-01", "2025-12-31", undefined),
    );
  });

  it("every chart has a table view", async () => {
    renderDashboard();
    const card = (await screen.findByText("Revenue vs expenses")).closest("[data-widget]") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Show as table" }));
    const table = within(card).getByRole("table");
    // One row per step: label, revenue, expenses.
    const second = within(table).getAllByRole("row")[2];
    expect(within(second).getByText("700.00")).toBeInTheDocument();
    expect(within(second).getByText("500.00")).toBeInTheDocument();
  });

  it("suggests the aging chart when customers are overdue, and adds it", async () => {
    renderDashboard();
    const suggestion = (await screen.findByText(/Customers owe 750.00 past the due date/)).closest("li") as HTMLElement;
    fireEvent.click(within(suggestion).getByRole("button", { name: "Add to dashboard" }));
    await waitFor(() => expect(saveLayout).toHaveBeenCalled());
    expect(saveLayout.mock.calls[0][1].widgets.map((w) => w.key)).toContain("receivablesAging");
  });

  it("customises the layout from a preset and saves it", async () => {
    renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Customise" }));
    fireEvent.click(screen.getByRole("button", { name: /Cash & debts.*how late they are/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Top vendors" }));
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));

    await waitFor(() => expect(saveLayout).toHaveBeenCalled());
    expect(saveLayout.mock.calls[0][1].widgets.map((w) => w.key)).toEqual([
      "kpi.cash", "kpi.receivables", "kpi.payables", "kpi.overduePayables", "cashTrend", "receivablesAging", "payablesAging",
    ]);
  });
});
