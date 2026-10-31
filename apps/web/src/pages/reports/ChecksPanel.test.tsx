import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiException } from "@pako/shared";

import fixture from "@/mocks/report-checks.json";

import { renderReports } from "./testHarness";

const m = vi.hoisted(() => ({ checks: vi.fn(), profitAndLoss: vi.fn() }));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

describe("ChecksPanel", () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.checks.mockResolvedValue(fixture);
  });

  it("renders the six checks for the selected period, the failing one in amber", async () => {
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    expect(await screen.findByText("Cash flow closes")).toBeInTheDocument();
    expect(m.checks).toHaveBeenCalledWith("c1", "2026-01-01", "2026-12-31");
    for (const label of [
      "Balance sheet balances",
      "Net profit is consistent",
      "Cash flow closes",
      "Trial balance balances",
      "Books match VAT return",
      "Vendor balances match payables",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Passed").length).toBe(5);
    const failing = screen.getByText("Cash flow closes").closest("[data-check]") as HTMLElement;
    expect(failing).toHaveAttribute("data-passed", "false");
    expect(failing.className).toContain("amber");
    expect(failing).toHaveTextContent("Failed");
    expect(failing).toHaveTextContent("45000.00");
    expect(failing).toHaveTextContent("44880.00");
    const passing = screen.getByText("Balance sheet balances").closest("[data-check]") as HTMLElement;
    expect(passing.className).not.toContain("amber");
  });

  it("has its own From input bound to the URL that re-runs the checks for the new range", async () => {
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    await screen.findByText("Cash flow closes");
    fireEvent.change(screen.getByLabelText("Checks from"), { target: { value: "2026-03-01" } });
    await waitFor(() => expect(m.checks).toHaveBeenLastCalledWith("c1", "2026-03-01", "2026-12-31"));
    expect(screen.getByTestId("location").textContent).toContain("from=2026-03-01");
  });

  it("shows a failing books-match-vat-return as informational with a note, not amber", async () => {
    m.checks.mockResolvedValue({
      ...fixture,
      checks: fixture.checks.map((c) => (c.key === "books-match-vat-return" ? { ...c, passed: false, actual: 17000 } : c)),
    });
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    const vat = (await screen.findByText("Books match VAT return")).closest("[data-check]") as HTMLElement;
    expect(vat).toHaveAttribute("data-informational", "true");
    expect(vat.className).not.toContain("amber");
    expect(vat).toHaveTextContent("Informational");
    expect(vat).toHaveTextContent("Reverse-charge");
    const other = screen.getByText("Cash flow closes").closest("[data-check]") as HTMLElement;
    expect(other).not.toHaveAttribute("data-informational");
    expect(other.className).toContain("amber");
    expect(other).not.toHaveTextContent("Reverse-charge");
  });

  it("keeps the normal pass badge for a passing books-match-vat-return", async () => {
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    const vat = (await screen.findByText("Books match VAT return")).closest("[data-check]") as HTMLElement;
    expect(vat).not.toHaveAttribute("data-informational");
    expect(vat).toHaveTextContent("Passed");
  });

  it("renders nothing for a 403 from the checks endpoint", async () => {
    m.checks.mockRejectedValue(new ApiException("Forbidden", 403, "", {}, null));
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    await waitFor(() => expect(m.checks).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByLabelText("Checks from")).not.toBeInTheDocument();
    expect(screen.queryByText("Could not load the report checks.")).not.toBeInTheDocument();
    expect(m.checks).toHaveBeenCalledTimes(1);
  });

  it("still shows the load error for a 500", async () => {
    m.checks.mockRejectedValue(new ApiException("Server error", 500, "", {}, null));
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    expect(await screen.findByText("Could not load the report checks.")).toBeInTheDocument();
  });

  it("summarises the checks in one line and expands the details by default when one failed", async () => {
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    expect(await screen.findByText("6 checks: 5 passed, 1 failed")).toBeInTheDocument();
    expect(screen.getByText("Cash flow closes")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByText("Cash flow closes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Cash flow closes")).toBeInTheDocument();
  });

  it("collapses the details by default when every check passed and expands on request", async () => {
    m.checks.mockResolvedValue({ ...fixture, checks: fixture.checks.map((c) => ({ ...c, passed: true })) });
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    expect(await screen.findByText("6 checks: all passed")).toBeInTheDocument();
    expect(screen.queryByText("Cash flow closes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Cash flow closes")).toBeInTheDocument();
  });
});
