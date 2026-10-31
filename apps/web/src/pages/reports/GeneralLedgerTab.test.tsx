import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/general-ledger.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  generalLedger: vi.fn(),
  generalLedgerExport: vi.fn(),
  checks: vi.fn(),
  accountsAll: vi.fn(),
  partnersAll: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const URL_ = "/reports?tab=general-ledger&from=2026-01-01&to=2026-12-31";

describe("GeneralLedgerTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.generalLedger.mockResolvedValue(fixture);
    m.generalLedgerExport.mockResolvedValue(fileResponse("gl.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-12-31", checks: [] });
    m.accountsAll.mockResolvedValue([]);
    m.partnersAll.mockResolvedValue([]);
  });

  it("renders the fixture rows with the real numbers", async () => {
    renderReports(URL_);
    expect(await screen.findByText("Trade receivables")).toBeInTheDocument();
    expect(screen.getByText("Revenue from sales")).toBeInTheDocument();
    expect(screen.getAllByText("1180.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Alba Trade SH.P.K.")).toBeInTheDocument();
    expect(m.generalLedger).toHaveBeenCalledWith("c1", "2026-01-01", "2026-12-31", undefined, undefined, 1, 50, undefined, undefined);
  });

  it("exports through generalLedgerExport", async () => {
    renderReports(URL_);
    await screen.findByText("Trade receivables");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.generalLedgerExport).toHaveBeenCalledWith("c1", "2026-01-01", "2026-12-31", undefined, undefined));
  });

  it("shows LockNotice when the range ends on or before the accounting lock date", async () => {
    renderReports("/reports?tab=general-ledger&from=2026-01-01&to=2026-08-31");
    expect(await screen.findByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();
  });

  it("does not show LockNotice for an open period", async () => {
    renderReports(URL_);
    await screen.findByText("Trade receivables");
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
  });

  it("paging control changes page", async () => {
    m.generalLedger.mockResolvedValue({ ...fixture, total: 120, pageSize: 50 });
    renderReports(URL_);
    await screen.findByText("Trade receivables");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(m.generalLedger).toHaveBeenLastCalledWith("c1", "2026-01-01", "2026-12-31", undefined, undefined, 2, 50, undefined, undefined));
    expect(screen.getByTestId("location").textContent).toContain("generalLedger.page=2");
  });

  it("passes account and partner filters from the URL", async () => {
    renderReports(`${URL_}&accountId=a1&partnerId=p1`);
    await waitFor(() =>
      expect(m.generalLedger).toHaveBeenCalledWith("c1", "2026-01-01", "2026-12-31", "a1", "p1", 1, 50, undefined, undefined),
    );
  });

  it("footer shows the server totals for the whole filtered set, not the page", async () => {
    m.generalLedger.mockResolvedValue({ ...fixture, total: 120, totalDebit: 98765.43, totalCredit: 98765.43 });
    renderReports(URL_);
    await screen.findByText("Trade receivables");
    const footer = document.querySelector("tfoot") as HTMLElement;
    expect(within(footer).getAllByText("98765.43")).toHaveLength(2);
    expect(within(footer).getByText("Total")).toBeInTheDocument();
  });

  it("shows the document type and document number columns", async () => {
    renderReports(URL_);
    await screen.findByText("Trade receivables");
    expect(screen.getByRole("columnheader", { name: /Document type/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Document number/ })).toBeInTheDocument();
    expect(screen.getAllByText("Invoice").length).toBeGreaterThan(0);
    expect(screen.getAllByText("INV-0001").length).toBeGreaterThan(0);
  });

  it("clamps a page beyond the last page back to the last page", async () => {
    m.generalLedger.mockImplementation(async (...args: unknown[]) =>
      args[5] === 1 ? { ...fixture, total: 22, page: 1, pageSize: 50 } : { ...fixture, items: [], total: 22, page: args[5], pageSize: 50 },
    );
    renderReports(`${URL_}&generalLedger.page=3&generalLedger.q=rent`);
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("generalLedger.page=3"));
    expect(await screen.findByText("Trade receivables")).toBeInTheDocument();
  });
});
