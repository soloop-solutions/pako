import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import payablesAging from "@/mocks/payables-aging.json";
import byItem from "@/mocks/purchases-by-item.json";
import byVendor from "@/mocks/purchases-by-vendor.json";
import stockMovements from "@/mocks/stock-movements.json";
import vendorStatement from "@/mocks/vendor-statement.json";
import vendorSynthetic from "@/mocks/vendor-synthetic.json";

import { renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  vendorSynthetic: vi.fn(),
  vendorStatement: vi.fn(),
  payablesAging: vi.fn(),
  purchasesByVendor: vi.fn(),
  purchasesByItem: vi.fn(),
  partnersAll: vi.fn(),
  stockMovementsReport: vi.fn(),
  listItemCategories: vi.fn(),
  listWarehouses: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const route = () => screen.getByTestId("route").textContent;
const PRIME = "5b1f0c2e-1a11-4c01-9a04-000000000001";
const KEDS = "5b1f0c2e-1a11-4c01-9a04-000000000002";

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-01-31", checks: [] });
  m.vendorSynthetic.mockResolvedValue(vendorSynthetic);
  m.vendorStatement.mockResolvedValue(vendorStatement);
  m.payablesAging.mockResolvedValue(payablesAging);
  m.purchasesByVendor.mockResolvedValue(byVendor);
  m.purchasesByItem.mockResolvedValue(byItem);
  m.partnersAll.mockResolvedValue([]);
  m.stockMovementsReport.mockResolvedValue(stockMovements);
  m.listItemCategories.mockResolvedValue([]);
  m.listWarehouses.mockResolvedValue([]);
});

describe("vendors report", () => {
  const URL_ = "/reports?tab=vendors&from=2026-01-01&to=2026-01-31";

  it("a vendor row opens the vendor", async () => {
    renderReports(URL_);
    fireEvent.click(await screen.findByText("KEDS J.S.C."));
    expect(route()).toBe(`/vendors?open=${KEDS}`);
  });

  it("the Statement button opens the statement drawer and not the vendor", async () => {
    renderReports(URL_);
    const row = (await screen.findByText("KEDS J.S.C.")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Statement" }));
    expect(route()).toBe(`/reports?tab=vendors&from=2026-01-01&to=2026-01-31&vendor=${KEDS}`);
  });

  it("the total row is not clickable", async () => {
    renderReports(URL_);
    await screen.findByText("KEDS J.S.C.");
    const footer = document.querySelector("tfoot tr") as HTMLElement;
    expect(footer.className).not.toContain("cursor-pointer");
    const before = route();
    fireEvent.click(footer);
    expect(route()).toBe(before);
  });
});

describe("payables aging by vendor", () => {
  it("a matrix row opens the vendor and the total row is inert", async () => {
    renderReports("/reports?tab=payables-aging&asOf=2026-01-31&view=vendor");
    const matrix = await screen.findByTestId("vendor-matrix");
    const footer = matrix.querySelector("tfoot tr") as HTMLElement;
    expect(footer.className).not.toContain("cursor-pointer");
    fireEvent.click(within(matrix).getByText("Prime Properties L.L.C."));
    expect(route()).toBe(`/vendors?open=${PRIME}`);
  });
});

describe("purchases by vendor and by item", () => {
  const BASE = "/reports?tab=purchases&from=2026-01-01&to=2026-01-31";

  it("by vendor: a row opens the vendor", async () => {
    renderReports(BASE);
    fireEvent.click(await screen.findByText("Prime Properties L.L.C."));
    expect(route()).toBe(`/vendors?open=${PRIME}`);
  });

  it("by vendor: the total row is not clickable", async () => {
    renderReports(BASE);
    await screen.findByText("Prime Properties L.L.C.");
    expect((document.querySelector("tfoot tr") as HTMLElement).className).not.toContain("cursor-pointer");
  });

  it("by item: a row with an item opens the item", async () => {
    renderReports(`${BASE}&view=by-item`);
    fireEvent.click(await screen.findByText("Electricity"));
    expect(route()).toBe("/items?open=5b1f0c2e-1a11-4c01-9a06-000000000001");
  });

  it("by item: a free-text line without an item stays inert", async () => {
    renderReports(`${BASE}&view=by-item`);
    const cell = await screen.findByText("Office rent January 2026");
    expect((cell.closest("tr") as HTMLElement).className).not.toContain("cursor-pointer");
    const before = route();
    fireEvent.click(cell);
    expect(route()).toBe(before);
  });

  it("by item: the total row is not clickable", async () => {
    renderReports(`${BASE}&view=by-item`);
    await screen.findByText("Electricity");
    expect((document.querySelector("tfoot tr") as HTMLElement).className).not.toContain("cursor-pointer");
  });
});

describe("stock movements", () => {
  const URL_ = "/reports?tab=stock-movements&from=2026-03-05&to=2026-03-31";

  it("a row opens the item and the total row is not clickable", async () => {
    renderReports(URL_);
    await screen.findByText("Laptop");
    expect((document.querySelector("tfoot tr") as HTMLElement).className).not.toContain("cursor-pointer");
    fireEvent.click(screen.getByText("Laptop"));
    expect(route()).toBe("/items?open=3f1d2c4e-6a7b-4c8d-9e0f-1a2b3c4d5e01");
  });
});
