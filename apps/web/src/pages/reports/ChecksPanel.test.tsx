import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("renders the five checks for the selected period, the failing one in amber", async () => {
    renderReports("/reports?from=2026-01-01&to=2026-12-31");
    expect(await screen.findByText("Cash flow closes")).toBeInTheDocument();
    expect(m.checks).toHaveBeenCalledWith("c1", "2026-01-01", "2026-12-31");
    for (const label of [
      "Balance sheet balances",
      "Net profit is consistent",
      "Cash flow closes",
      "Trial balance balances",
      "Books match VAT return",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Passed").length).toBe(4);
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
});
