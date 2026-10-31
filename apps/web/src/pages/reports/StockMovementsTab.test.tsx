import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiException } from "@pako/shared";

import fixture from "@/mocks/stock-movements.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  stockMovementsReport: vi.fn(),
  stockMovementsExport: vi.fn(),
  checks: vi.fn(),
  listItemCategories: vi.fn(),
  listWarehouses: vi.fn(),
}));
const access = vi.hoisted(() => ({ canSee: vi.fn() }));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: access.canSee, canWrite: () => true, canApprove: () => true }),
}));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const URL_ = "/reports?tab=stock-movements&from=2026-03-05&to=2026-03-31";

describe("StockMovementsTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    access.canSee.mockReset();
    access.canSee.mockReturnValue(true);
    m.stockMovementsReport.mockResolvedValue(fixture);
    m.stockMovementsExport.mockResolvedValue(fileResponse("sm.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-03-05", to: "2026-03-31", checks: [] });
    m.listItemCategories.mockResolvedValue([]);
    m.listWarehouses.mockResolvedValue([]);
  });

  it("renders the fixture rows and every column header", async () => {
    renderReports(URL_);
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("Mouse")).toBeInTheDocument();
    expect(screen.getByText("Computers")).toBeInTheDocument();
    for (const header of [
      "Code",
      "Name",
      "Unit",
      "Category",
      "Opening qty",
      "Opening value",
      "In qty",
      "In value",
      "Out qty",
      "Out value",
      "Closing qty",
      "Average cost",
      "Closing value",
      "Sell price ex VAT",
      "Markup %",
    ]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    expect(m.stockMovementsReport).toHaveBeenCalledWith("c1", "2026-03-05", "2026-03-31", undefined, undefined, undefined, 1, 50, undefined);
  });

  it("footer shows the server totals, not browser sums", async () => {
    m.stockMovementsReport.mockResolvedValue({
      ...fixture,
      totalOpeningValue: 11111.11,
      totalInValue: 22222.22,
      totalOutValue: 33333.33,
      totalClosingValue: 44444.44,
    });
    renderReports(URL_);
    await screen.findByText("Laptop");
    const footer = document.querySelector("tfoot") as HTMLElement;
    expect(within(footer).getByText("11111.11")).toBeInTheDocument();
    expect(within(footer).getByText("22222.22")).toBeInTheDocument();
    expect(within(footer).getByText("33333.33")).toBeInTheDocument();
    expect(within(footer).getByText("44444.44")).toBeInTheDocument();
    expect(within(footer).getByText("Total")).toBeInTheDocument();
  });

  it("passes category, warehouse, search and sort from the URL", async () => {
    renderReports(`${URL_}&category=cat1&warehouse=wh1&stockMovements.q=lap&stockMovements.sort=-closingValue`);
    await waitFor(() =>
      expect(m.stockMovementsReport).toHaveBeenCalledWith("c1", "2026-03-05", "2026-03-31", "lap", "cat1", "wh1", 1, 50, "-closingValue"),
    );
  });

  it("paging control changes page in the URL", async () => {
    m.stockMovementsReport.mockResolvedValue({ ...fixture, total: 120 });
    renderReports(URL_);
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(m.stockMovementsReport).toHaveBeenLastCalledWith("c1", "2026-03-05", "2026-03-31", undefined, undefined, undefined, 2, 50, undefined),
    );
    expect(screen.getByTestId("location").textContent).toContain("stockMovements.page=2");
  });

  it("changing the period re-runs the report with the new range", async () => {
    renderReports(URL_);
    await screen.findByText("Laptop");
    fireEvent.change(screen.getByLabelText("From", { selector: "#stock-movements-from" }), { target: { value: "2026-03-10" } });
    await waitFor(() =>
      expect(m.stockMovementsReport).toHaveBeenLastCalledWith("c1", "2026-03-10", "2026-03-31", undefined, undefined, undefined, 1, 50, undefined),
    );
    expect(screen.getByTestId("location").textContent).toContain("from=2026-03-10");
  });

  it("exports through stockMovementsExport with the same filters", async () => {
    renderReports(`${URL_}&category=cat1&warehouse=wh1&stockMovements.q=lap&stockMovements.sort=name`);
    await screen.findByText("Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() =>
      expect(m.stockMovementsExport).toHaveBeenCalledWith("c1", "2026-03-05", "2026-03-31", "lap", "cat1", "wh1", "name"),
    );
  });

  it("shows the standard empty state when the company has no stock-tracked items", async () => {
    m.stockMovementsReport.mockResolvedValue({
      ...fixture,
      items: [],
      total: 0,
      totalOpeningValue: 0,
      totalInValue: 0,
      totalOutValue: 0,
      totalClosingValue: 0,
    });
    renderReports(URL_);
    expect(await screen.findByText(/No stock-tracked items yet/)).toBeInTheDocument();
  });

  it("shows an access message, not a crash, on a 403", async () => {
    m.stockMovementsReport.mockRejectedValue(new ApiException("Forbidden", 403, "", {}, null));
    renderReports(URL_);
    expect(await screen.findByText("You do not have access to the stock movements report.")).toBeInTheDocument();
    expect(screen.queryByText("Laptop")).not.toBeInTheDocument();
  });

  it("shows the server's message for a failed load, not a crash", async () => {
    m.stockMovementsReport.mockRejectedValue(new ApiException("Bad", 400, JSON.stringify({ error: "The date range is invalid." }), {}, null));
    renderReports(URL_);
    expect(await screen.findByText("The date range is invalid.")).toBeInTheDocument();
    expect(screen.queryByText("Laptop")).not.toBeInTheDocument();
  });

  it("shows the tab only to users who can see the Inventory area", async () => {
    renderReports("/reports");
    expect(await screen.findByRole("button", { name: "Stock movements (Komplet)" })).toBeInTheDocument();
    expect(access.canSee).toHaveBeenCalledWith("inventory");
  });

  it("hides the tab and never calls the endpoint without Inventory access", async () => {
    access.canSee.mockImplementation((module: string) => module !== "inventory");
    renderReports(URL_);
    await waitFor(() => expect(m.checks).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Stock movements (Komplet)" })).not.toBeInTheDocument();
    expect(m.stockMovementsReport).not.toHaveBeenCalled();
  });
});
