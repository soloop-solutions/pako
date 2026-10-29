import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/equity-statement.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  equityStatement: vi.fn(),
  equityStatementExport: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const URL_ = "/reports?tab=equity&from=2026-01-01&to=2026-12-31";

describe("EquityTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.equityStatement.mockResolvedValue(fixture);
    m.equityStatementExport.mockResolvedValue(fileResponse("eq.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-12-31", checks: [] });
  });

  it("renders opening equity, movements, net income and closing equity", async () => {
    renderReports(URL_);
    expect(await screen.findByText("Opening equity")).toBeInTheDocument();
    expect(screen.getByText("Retained earnings (dividends paid)")).toBeInTheDocument();
    expect(screen.getByText("-20000.00")).toBeInTheDocument();
    expect(screen.getByText("Closing equity")).toBeInTheDocument();
    expect(screen.getByText("70000.00")).toBeInTheDocument();
    expect(screen.getAllByText("45000.00").length).toBe(2);
  });

  it("exports through equityStatementExport", async () => {
    renderReports(URL_);
    await screen.findByText("Opening equity");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.equityStatementExport).toHaveBeenCalledWith("c1", "2026-01-01", "2026-12-31"));
  });

  it("shows LockNotice when the range ends on or before the lock date", async () => {
    renderReports("/reports?tab=equity&from=2026-01-01&to=2026-08-31");
    expect(await screen.findByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();
  });
});
