import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/cash-flow.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  cashFlow: vi.fn(),
  cashFlowExport: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const URL_ = "/reports?tab=cash-flow&from=2026-01-01&to=2026-12-31";

describe("CashFlowTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.cashFlow.mockResolvedValue(fixture);
    m.cashFlowExport.mockResolvedValue(fileResponse("cf.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-12-31", checks: [] });
  });

  it("renders sections, net change, opening and closing cash", async () => {
    renderReports(URL_);
    expect(await screen.findByText("Operating activities")).toBeInTheDocument();
    expect(screen.getByText("Investing activities")).toBeInTheDocument();
    expect(screen.getByText("Financing activities")).toBeInTheDocument();
    expect(screen.getByText("Trade receivables")).toBeInTheDocument();
    expect(screen.getByText("-5000.00")).toBeInTheDocument();
    expect(screen.getByText("Net change in cash")).toBeInTheDocument();
    expect(screen.getByText("15000.00")).toBeInTheDocument();
    expect(screen.getByText("Opening cash")).toBeInTheDocument();
    expect(screen.getByText("30000.00")).toBeInTheDocument();
    expect(screen.getByText("Closing cash")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a non-zero Difference prominently", async () => {
    m.cashFlow.mockResolvedValue({ ...fixture, difference: 120.5 });
    renderReports(URL_);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("120.50");
    expect(alert).toHaveTextContent("Difference");
  });

  it("exports through cashFlowExport", async () => {
    renderReports(URL_);
    await screen.findByText("Operating activities");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.cashFlowExport).toHaveBeenCalledWith("c1", "2026-01-01", "2026-12-31"));
  });

  it("shows LockNotice when the range ends on or before the lock date", async () => {
    renderReports("/reports?tab=cash-flow&from=2026-01-01&to=2026-08-31");
    expect(await screen.findByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();
  });
});
