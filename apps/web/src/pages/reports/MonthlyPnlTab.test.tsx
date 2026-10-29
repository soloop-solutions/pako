import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/pnl-monthly.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  monthly: vi.fn(),
  monthlyProfitAndLossExport: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

describe("MonthlyPnlTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.monthly.mockResolvedValue(fixture);
    m.monthlyProfitAndLossExport.mockResolvedValue(fileResponse("m.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-12-31", checks: [] });
  });

  it("renders 12 month columns plus Total and the supplied profit rows", async () => {
    renderReports("/reports?tab=monthly-pnl&year=2026");
    expect(await screen.findByText("Revenue from sales")).toBeInTheDocument();
    expect(m.monthly).toHaveBeenCalledWith("c1", 2026);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    for (const month of ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Total"]) {
      expect(headers).toContain(month);
    }
    expect(screen.getByText("155000.00")).toBeInTheDocument();
    const gross = screen.getByText("Gross profit").closest("tr") as HTMLElement;
    expect(within(gross).getByText("93000.00")).toBeInTheDocument();
    expect(within(gross).getByText("6000.00")).toBeInTheDocument();
    const net = screen.getByText("Net income").closest("tr") as HTMLElement;
    expect(within(net).getByText("45000.00")).toBeInTheDocument();
    expect(within(net).getByText("5600.00")).toBeInTheDocument();
  });

  it("exports through monthlyProfitAndLossExport", async () => {
    renderReports("/reports?tab=monthly-pnl&year=2026");
    await screen.findByText("Revenue from sales");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.monthlyProfitAndLossExport).toHaveBeenCalledWith("c1", 2026));
  });

  it("shows LockNotice when the year ends on or before the accounting lock date", async () => {
    renderReports("/reports?tab=monthly-pnl&year=2025");
    expect(await screen.findByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();
  });
});
