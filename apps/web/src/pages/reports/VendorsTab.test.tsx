import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import statementFixture from "@/mocks/vendor-statement.json";
import fixture from "@/mocks/vendor-synthetic.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  vendorSynthetic: vi.fn(),
  vendorSyntheticExport: vi.fn(),
  vendorStatement: vi.fn(),
  vendorStatementExport: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const URL_ = "/reports?tab=vendors&from=2026-01-01&to=2026-01-31";
const PRIME = "5b1f0c2e-1a11-4c01-9a04-000000000001";

describe("VendorsTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.vendorSynthetic.mockResolvedValue(fixture);
    m.vendorSyntheticExport.mockResolvedValue(fileResponse("v.xlsx"));
    m.vendorStatement.mockResolvedValue(statementFixture);
    m.vendorStatementExport.mockResolvedValue(fileResponse("s.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-01-01", to: "2026-01-31", checks: [] });
  });

  it("renders fixture rows and the server totalClosing in the footer", async () => {
    renderReports(URL_);
    expect(await screen.findByText("KEDS J.S.C.")).toBeInTheDocument();
    expect(screen.getByText("Telekomi i Kosoves J.S.C.")).toBeInTheDocument();
    expect(screen.getAllByText("354.00").length).toBe(2);
    expect(screen.getByText("1180.00", { selector: "td:last-child" })).toBeInTheDocument();
    expect(screen.getByText("1474.00")).toBeInTheDocument();
    expect(m.vendorSynthetic).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31", false);
  });

  it("renders a negative closing with a minus sign, distinct style and a legend", async () => {
    renderReports(URL_);
    const negative = await screen.findByText("-300.00");
    expect(negative).toHaveAttribute("data-vendor-owes-us", "true");
    expect(negative.className).toContain("amber");
    expect(screen.getByText(/the vendor owes us/i)).toBeInTheDocument();
  });

  it("hides the vendor-owes-us legend when no row has a negative closing", async () => {
    m.vendorSynthetic.mockResolvedValue({
      ...fixture,
      lines: fixture.lines.filter((line) => line.closing >= 0),
    });
    renderReports(URL_);
    await screen.findByText("KEDS J.S.C.");
    expect(screen.queryByText(/the vendor owes us/i)).not.toBeInTheDocument();
  });

  it("passes the include-zero toggle to the client", async () => {
    renderReports(URL_);
    await screen.findByText("KEDS J.S.C.");
    fireEvent.click(screen.getByLabelText("Include zero balances"));
    await waitFor(() => expect(m.vendorSynthetic).toHaveBeenLastCalledWith("c1", "2026-01-01", "2026-01-31", true));
    expect(screen.getByTestId("location").textContent).toContain("includeZero=1");
  });

  it("exports through vendorSyntheticExport", async () => {
    renderReports(URL_);
    await screen.findByText("KEDS J.S.C.");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.vendorSyntheticExport).toHaveBeenCalledWith("c1", "2026-01-01", "2026-01-31", false));
  });

  it("opens the statement drawer from the Statement button and puts the vendor in the URL", async () => {
    renderReports(URL_);
    const row = (await screen.findByText("Prime Properties L.L.C.")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Statement" }));
    await waitFor(() => expect(m.vendorStatement).toHaveBeenCalledWith("c1", PRIME, "2026-01-01", "2026-01-31"));
    expect(screen.getByTestId("location").textContent).toContain(`vendor=${PRIME}`);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("BILL-0001")).toBeInTheDocument();
    expect(within(dialog).getByText("Office rent January 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("1680.00")).toBeInTheDocument();
    expect(within(dialog).getByText("PAY-0001")).toBeInTheDocument();
    expect(within(dialog).getByText("Opening balance")).toBeInTheDocument();
    expect(within(dialog).getByText("Closing balance")).toBeInTheDocument();
  });

  it("opens the drawer straight from ?vendor= and exports the statement", async () => {
    renderReports(`${URL_}&vendor=${PRIME}`);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("BILL-0001");
    fireEvent.click(within(dialog).getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.vendorStatementExport).toHaveBeenCalledWith("c1", PRIME, "2026-01-01", "2026-01-31"));
  });

  it("shows the server totalDebit and totalCredit in a totals row of the statement", async () => {
    m.vendorStatement.mockResolvedValue({ ...statementFixture, totalDebit: 777.7, totalCredit: 888.8 });
    renderReports(`${URL_}&vendor=${PRIME}`);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("BILL-0001");
    const footer = dialog.querySelector("tfoot") as HTMLElement;
    expect(within(footer).getByText("Total")).toBeInTheDocument();
    expect(within(footer).getByText("777.70")).toBeInTheDocument();
    expect(within(footer).getByText("888.80")).toBeInTheDocument();
  });

  it("shows LockNotice when the range ends on or before the accounting lock date", async () => {
    renderReports("/reports?tab=vendors&from=2026-01-01&to=2026-08-31");
    expect(await screen.findByText("This period is locked (accounting lock: 2026-08-31).")).toBeInTheDocument();
  });
});
