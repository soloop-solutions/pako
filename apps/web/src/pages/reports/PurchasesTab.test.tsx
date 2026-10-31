import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import byItem from "@/mocks/purchases-by-item.json";
import byVendor from "@/mocks/purchases-by-vendor.json";
import transactions from "@/mocks/purchase-transactions.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  purchasesByVendor: vi.fn(),
  purchasesByItem: vi.fn(),
  purchaseTransactions: vi.fn(),
  purchasesByVendorExport: vi.fn(),
  purchasesByItemExport: vi.fn(),
  purchaseTransactionsExport: vi.fn(),
  partnersAll: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const BASE = "/reports?tab=purchases&from=2026-01-01&to=2026-01-31";

describe("PurchasesTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.purchasesByVendor.mockResolvedValue(byVendor);
    m.purchasesByItem.mockResolvedValue(byItem);
    m.purchaseTransactions.mockResolvedValue(transactions);
    m.purchasesByVendorExport.mockResolvedValue(fileResponse("a.xlsx"));
    m.purchasesByItemExport.mockResolvedValue(fileResponse("b.xlsx"));
    m.purchaseTransactionsExport.mockResolvedValue(fileResponse("c.xlsx"));
    m.partnersAll.mockResolvedValue([]);
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-01-31", checks: [] });
  });

  it("defaults to the by-vendor view with fixture numbers and the server totals row", async () => {
    renderReports(BASE);
    expect(await screen.findByText("Kosova Office Supplies SH.P.K.")).toBeInTheDocument();
    expect(m.purchasesByVendor).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31");
    expect(screen.getByText("448.40")).toBeInTheDocument();
    expect(screen.getByText("203.39")).toBeInTheDocument();
    const footer = document.querySelector("tfoot") as HTMLElement;
    expect(within(footer).getByText("Total")).toBeInTheDocument();
    expect(within(footer).getByText("1883.39")).toBeInTheDocument();
    expect(within(footer).getByText("20.00")).toBeInTheDocument();
    expect(within(footer).getByText("339.01")).toBeInTheDocument();
    expect(within(footer).getByText("2222.40")).toBeInTheDocument();
  });

  it("switches views through the URL", async () => {
    renderReports(BASE);
    await screen.findByText("Kosova Office Supplies SH.P.K.");
    fireEvent.click(screen.getByRole("button", { name: "By item" }));
    expect(await screen.findByText("SRV-ELE")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toContain("view=by-item");
    expect(m.purchasesByItem).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31");
    expect(screen.getByText("A4 printer paper")).toBeInTheDocument();
    expect(screen.getByText("1200.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
    expect(await screen.findByText("BILL-0005")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toContain("view=transactions");
  });

  it("exports each view through its own client method", async () => {
    renderReports(BASE);
    await screen.findByText("Kosova Office Supplies SH.P.K.");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.purchasesByVendorExport).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31"));

    fireEvent.click(screen.getByRole("button", { name: "By item" }));
    await screen.findByText("SRV-ELE");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.purchasesByItemExport).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31"));

    fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
    await screen.findByText("BILL-0005");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.purchaseTransactionsExport).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31", undefined));
  });

  it("renders transactions and pages through the URL", async () => {
    m.purchaseTransactions.mockResolvedValue({ ...transactions, total: 120, pageSize: 50 });
    renderReports(`${BASE}&view=transactions`);
    expect(await screen.findByText("BILL-0005")).toBeInTheDocument();
    expect(screen.getByText("0.169492")).toBeInTheDocument();
    expect(m.purchaseTransactions).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31", undefined, 1, 50, undefined, undefined);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(m.purchaseTransactions).toHaveBeenLastCalledWith("c1", "2026-01-01", "2026-01-31", undefined, 2, 50, undefined, undefined),
    );
    expect(screen.getByTestId("location").textContent).toContain("purchaseTransactions.page=2");
  });

  it("passes the partner filter from the URL", async () => {
    renderReports(`${BASE}&view=transactions&partnerId=p1`);
    await waitFor(() =>
      expect(m.purchaseTransactions).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31", "p1", 1, 50, undefined, undefined),
    );
  });

  it("shows LockNotice when the range ends on or before the accounting lock date", async () => {
    renderReports("/reports?tab=purchases&from=2026-01-01&to=2026-08-31");
    expect(await screen.findByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();
  });

  it("renders the server totals, not browser sums, in every view", async () => {
    m.purchasesByVendor.mockResolvedValue({ ...byVendor, totalNet: 7777.77, totalDiscount: 1.11, totalVat: 2.22, totalGross: 3.33 });
    m.purchasesByItem.mockResolvedValue({ ...byItem, totalNet: 4444.44, totalVat: 5.55, totalGross: 6.66 });
    m.purchaseTransactions.mockResolvedValue({ ...transactions, total: 120, totalNet: 8888.88, totalVat: 9.99, totalGross: 10.1 });
    renderReports(BASE);
    await screen.findByText("Kosova Office Supplies SH.P.K.");
    let footer = document.querySelector("tfoot") as HTMLElement;
    ["7777.77", "1.11", "2.22", "3.33"].forEach((v) => expect(within(footer).getByText(v)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "By item" }));
    await screen.findByText("SRV-ELE");
    footer = document.querySelector("tfoot") as HTMLElement;
    ["4444.44", "5.55", "6.66"].forEach((v) => expect(within(footer).getByText(v)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
    await screen.findByText("BILL-0005");
    footer = document.querySelector("tfoot") as HTMLElement;
    ["8888.88", "9.99", "10.10"].forEach((v) => expect(within(footer).getByText(v)).toBeInTheDocument());
  });
});
