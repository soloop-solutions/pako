import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiException } from "@pako/shared";

import fixture from "@/mocks/vat-declaration.json";

import { fileResponse, renderReports } from "./testHarness";

const m = vi.hoisted(() => ({
  vatDeclaration: vi.fn(),
  vatDeclarationExport: vi.fn(),
  checks: vi.fn(),
}));

vi.mock("@/context/CompanyContext", async () => (await import("./testCompany")).companyContextMock);
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});

const URL_ = "/reports?tab=vat-declaration&year=2026&month=9";

describe("VatDeclarationTab", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    localStorage.clear();
    Object.values(m).forEach((fn) => fn.mockReset());
    m.vatDeclaration.mockResolvedValue(fixture);
    m.vatDeclarationExport.mockResolvedValue(fileResponse("vat-declaration.xlsx"));
    m.checks.mockResolvedValue({ from: "2026-09-01", to: "2026-09-30", checks: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has a VAT declaration tab that loads the chosen month with no optional credit params", async () => {
    renderReports(URL_);
    expect(await screen.findByText("Taxable sales at 18%")).toBeInTheDocument();
    expect(m.vatDeclaration).toHaveBeenCalledWith("c1", 2026, 9, undefined, undefined);
    expect(screen.getByRole("button", { name: "VAT declaration" })).toBeInTheDocument();
  });

  it("shows the taxpayer header from the server", async () => {
    renderReports(URL_);
    await screen.findByText("Taxable sales at 18%");
    expect(screen.getByText("Example Trading SH.P.K.")).toBeInTheDocument();
    expect(screen.getByText("811000000")).toBeInTheDocument();
    expect(screen.getByText("Rruga Shembull 1, Prishtinë")).toBeInTheDocument();
  });

  it("groups the boxes by the server's section with Box, Description, Base and VAT columns", async () => {
    renderReports(URL_);
    await screen.findByText("Taxable sales at 18%");
    const sales = screen.getByTestId("vat-decl-section-Sales");
    const purchases = screen.getByTestId("vat-decl-section-Purchases");
    expect(within(sales).getByText("Sales")).toBeInTheDocument();
    expect(within(purchases).getByText("Purchases")).toBeInTheDocument();
    for (const name of ["Box", "Description", "Base", "VAT"]) {
      expect(within(sales).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    const row = within(sales).getByText("Taxable sales at 18%").closest("tr") as HTMLElement;
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("44408.45")).toBeInTheDocument();
    expect(within(row).getByText("7993.57")).toBeInTheDocument();
    const total = within(sales).getByText("Total VAT calculated").closest("tr") as HTMLElement;
    expect(within(total).getByText("7993.57")).toBeInTheDocument();
    const deductible = within(purchases).getByText("Total deductible VAT").closest("tr") as HTMLElement;
    expect(within(deductible).getByText("8140.14")).toBeInTheDocument();
    expect(within(sales).queryByText("Total deductible VAT")).not.toBeInTheDocument();
  });

  it("highlights the server's remaining credit, credit for next period and VAT payable", async () => {
    m.vatDeclaration.mockResolvedValue({ ...fixture, remainingCredit: 111.11, creditForNextPeriod: 222.22, vatPayable: 333.33 });
    renderReports(URL_);
    await screen.findByText("Taxable sales at 18%");
    const calc = screen.getByTestId("vat-decl-calculation");
    expect(within(calc).getByText("111.11")).toBeInTheDocument();
    expect(within(calc).getByText("222.22")).toBeInTheDocument();
    expect(within(calc).getByText("333.33")).toBeInTheDocument();
    expect(within(calc).getByText("Remaining credit balance [69]")).toBeInTheDocument();
    expect(within(calc).getByText("VAT payable [72]")).toBeInTheDocument();
  });

  it("sends the carried credit and refund only when filled, and keeps them in the URL", async () => {
    renderReports(URL_);
    await screen.findByText("Taxable sales at 18%");
    const credit = screen.getByLabelText("Credit carried forward [68]");
    fireEvent.change(credit, { target: { value: "500" } });
    fireEvent.blur(credit);
    await waitFor(() => expect(m.vatDeclaration).toHaveBeenLastCalledWith("c1", 2026, 9, 500, undefined));
    expect(screen.getByTestId("location").textContent).toContain("carriedCredit=500");
    const refund = screen.getByLabelText("Refund requested [70]");
    fireEvent.change(refund, { target: { value: "25.5" } });
    fireEvent.blur(refund);
    await waitFor(() => expect(m.vatDeclaration).toHaveBeenLastCalledWith("c1", 2026, 9, 500, 25.5));
    fireEvent.change(credit, { target: { value: "" } });
    fireEvent.blur(credit);
    await waitFor(() => expect(m.vatDeclaration).toHaveBeenLastCalledWith("c1", 2026, 9, undefined, 25.5));
  });

  it("changes year and month through the URL", async () => {
    renderReports(URL_);
    await screen.findByText("Taxable sales at 18%");
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "8" } });
    await waitFor(() => expect(m.vatDeclaration).toHaveBeenLastCalledWith("c1", 2026, 8, undefined, undefined));
    expect(screen.getByTestId("location").textContent).toContain("month=8");
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2025" } });
    await waitFor(() => expect(m.vatDeclaration).toHaveBeenLastCalledWith("c1", 2025, 8, undefined, undefined));
  });

  it("defaults to the current month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 12, 0, 0));
    renderReports("/reports?tab=vat-declaration");
    await waitFor(() => expect(m.vatDeclaration).toHaveBeenCalledWith("c1", 2026, 10, undefined, undefined));
  });

  it("exports through vatDeclarationExport with the same parameters", async () => {
    renderReports(`${URL_}&carriedCredit=1000&refundRequested=5`);
    await screen.findByText("Taxable sales at 18%");
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.vatDeclarationExport).toHaveBeenCalledWith("c1", 2026, 9, 1000, 5));
  });

  it("renders section titles and headers in Albanian", async () => {
    localStorage.setItem("pako.language", "sq");
    renderReports(URL_);
    await screen.findByText("Taxable sales at 18%");
    const sales = screen.getByTestId("vat-decl-section-Sales");
    expect(within(sales).getByText("Shitjet")).toBeInTheDocument();
    expect(within(sales).getByRole("columnheader", { name: "Kutia" })).toBeInTheDocument();
    expect(within(sales).getByRole("columnheader", { name: "Baza" })).toBeInTheDocument();
  });

  it("shows decoded text for labels the server escapes", async () => {
    renderReports(URL_);
    expect(await screen.findByText("Remaining credit balance, 69 = ((67+68)-30) > 0")).toBeInTheDocument();
  });

  it("shows the server's specific 400 message inline and keeps the last good report visible", async () => {
    renderReports(URL_);
    await screen.findByText("Taxable sales at 18%");
    m.vatDeclaration.mockRejectedValue(new ApiException("bad", 400, JSON.stringify({ error: "Refund cannot exceed the remaining credit." }), {}, null));
    const refund = screen.getByLabelText("Refund requested [70]");
    fireEvent.change(refund, { target: { value: "99999" } });
    fireEvent.blur(refund);
    expect(await screen.findByText("Refund cannot exceed the remaining credit.")).toBeInTheDocument();
    expect(screen.queryByText("An unexpected server error occurred")).not.toBeInTheDocument();
    expect(screen.getByText("Taxable sales at 18%")).toBeInTheDocument();
  });

  it("applies the carried credit while typing after a 400 ms debounce", async () => {
    renderReports(URL_);
    await screen.findByText("Taxable sales at 18%");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const credit = screen.getByLabelText("Credit carried forward [68]");
    fireEvent.change(credit, { target: { value: "5" } });
    fireEvent.change(credit, { target: { value: "50" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(m.vatDeclaration).not.toHaveBeenCalledWith("c1", 2026, 9, 50, undefined);
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    vi.useRealTimers();
    await waitFor(() => expect(m.vatDeclaration).toHaveBeenLastCalledWith("c1", 2026, 9, 50, undefined));
    expect(m.vatDeclaration).not.toHaveBeenCalledWith("c1", 2026, 9, 5, undefined);
  });

  it.each(["13", "0", "abc"])("rejects an invalid month param %s without calling the API", async (bad) => {
    renderReports(`/reports?tab=vat-declaration&year=2026&month=${bad}`);
    expect(await screen.findByText("Month must be a number from 1 to 12.")).toBeInTheDocument();
    expect(m.vatDeclaration).not.toHaveBeenCalled();
  });

  it("uses distinct Albanian labels for the VAT return and the VAT declaration tabs", async () => {
    localStorage.setItem("pako.language", "sq");
    renderReports(URL_);
    expect(await screen.findByRole("button", { name: "P\u00ebrmbledhja e TVSH-s\u00eb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deklarata e TVSH-s\u00eb (formulari)" })).toBeInTheDocument();
  });
});
