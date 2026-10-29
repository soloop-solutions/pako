import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/expense-book.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  expenseBook: vi.fn(),
  expenseBookExport: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const URL_ = "/reports?tab=expense-book&from=2026-01-01&to=2026-01-31";

describe("ExpenseBookTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.expenseBook.mockResolvedValue(fixture);
    m.expenseBookExport.mockResolvedValue(fileResponse("eb.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-01-31", checks: [] });
  });

  it("renders a column per expense account, aligned rows and the supplied ColumnTotals", async () => {
    renderReports(URL_);
    expect(await screen.findByText("BILL-0001")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["621 Rent", "622 Salaries", "631 Utilities"]));
    const row = screen.getByText("BILL-0002").closest("tr") as HTMLElement;
    expect(within(row).getByText("KEDS J.S.C.")).toBeInTheDocument();
    expect(within(row).getAllByText("240.00").length).toBe(2);
    const totals = screen.getByText("Column totals").closest("tr") as HTMLElement;
    expect(within(totals).getByText("1000.00")).toBeInTheDocument();
    expect(within(totals).getByText("3000.00")).toBeInTheDocument();
    expect(within(totals).getByText("240.00")).toBeInTheDocument();
  });

  it("exports through expenseBookExport", async () => {
    renderReports(URL_);
    await screen.findByText("BILL-0001");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.expenseBookExport).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31"));
  });

  it("shows LockNotice when the range ends on or before the lock date", async () => {
    renderReports("/reports?tab=expense-book&from=2026-01-01&to=2026-08-31");
    expect(await screen.findByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();
  });
});
