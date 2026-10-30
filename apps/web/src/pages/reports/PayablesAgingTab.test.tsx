import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/payables-aging.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  payablesAging: vi.fn(),
  payablesAgingExport: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const URL_ = "/reports?tab=payables-aging&asOf=2026-01-31";

describe("PayablesAgingTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.payablesAging.mockResolvedValue(fixture);
    m.payablesAgingExport.mockResolvedValue(fileResponse("a.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-01-31", checks: [] });
  });

  it("renders all eight bucket totals exactly from the fixture", async () => {
    renderReports(URL_);
    await screen.findByText("BILL-0004");
    expect(m.payablesAging).toHaveBeenCalledWith("c1", "2026-01-31");
    const expected: Record<string, string> = {
      Current: "1180.00",
      "1-30": "240.00",
      "31-45": "0.00",
      "46-60": "234.00",
      "61-90": "0.00",
      "91-180": "120.00",
      "181-360": "0.00",
      Over360: "0.00",
    };
    for (const [bucket, total] of Object.entries(expected)) {
      expect(within(screen.getByTestId(`bucket-${bucket}`)).getByText(total)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId(/^bucket-/).length).toBe(8);
  });

  it("renders the bill lines", async () => {
    renderReports(URL_);
    expect(await screen.findByText("BILL-0001")).toBeInTheDocument();
    expect(screen.getByText("BILL-0003")).toBeInTheDocument();
    expect(screen.getAllByText("Telekomi i Kosoves J.S.C.").length).toBe(2);
    expect(screen.getByText("2025-10-20")).toBeInTheDocument();
  });

  it("changes asOf through the URL", async () => {
    renderReports(URL_);
    await screen.findByText("BILL-0001");
    fireEvent.change(screen.getByLabelText("As of"), { target: { value: "2026-02-15" } });
    await waitFor(() => expect(m.payablesAging).toHaveBeenLastCalledWith("c1", "2026-02-15"));
    expect(screen.getByTestId("location").textContent).toContain("asOf=2026-02-15");
  });

  it("exports through payablesAgingExport", async () => {
    renderReports(URL_);
    await screen.findByText("BILL-0001");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.payablesAgingExport).toHaveBeenCalledWith("c1", "2026-01-31"));
  });
});
