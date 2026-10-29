import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import fixture from "@/mocks/withholding-tax-list.json";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { WithholdingTax } from "@/pages/tax/WithholdingTax";

const withholdingTaxGET = vi.fn();
const withholdingTaxPOST = vi.fn();
const withholdingTaxPUT = vi.fn();
const withholdingTaxDELETE = vi.fn();
const withholdingTaxExport = vi.fn();
const countries = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      withholdingTaxGET: (...args: unknown[]) => withholdingTaxGET(...args),
      withholdingTaxPOST: (...args: unknown[]) => withholdingTaxPOST(...args),
      withholdingTaxPUT: (...args: unknown[]) => withholdingTaxPUT(...args),
      withholdingTaxDELETE: (...args: unknown[]) => withholdingTaxDELETE(...args),
      withholdingTaxExport: (...args: unknown[]) => withholdingTaxExport(...args),
      countries: (...args: unknown[]) => countries(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderPage(initialEntry = "/withholding-tax?year=2025") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <WithholdingTax />
          <LocationProbe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("WithholdingTax", () => {
  beforeEach(() => {
    withholdingTaxGET.mockReset().mockResolvedValue(fixture);
    withholdingTaxPOST.mockReset().mockResolvedValue(fixture.items[0]);
    withholdingTaxPUT.mockReset().mockResolvedValue(fixture.items[0]);
    withholdingTaxDELETE.mockReset().mockResolvedValue(undefined);
    withholdingTaxExport.mockReset();
    countries.mockReset().mockResolvedValue({ countries: ["Kosova", "Shqiperia"], defaultCountry: "Kosova" });
  });

  it("loads the year from the URL and renders server-computed withheld tax and totals", async () => {
    renderPage();

    expect(await screen.findByText("Ljubica Azemi")).toBeInTheDocument();
    expect(withholdingTaxGET).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      2025,
      1,
      50,
      undefined,
      undefined,
    );
    expect(screen.getByTestId("withholding-tax-totals")).toHaveTextContent("0.90");
    expect(screen.getByText(/10%/)).toBeInTheDocument();
  });

  it("creates an entry for the selected year without computing the tax in the browser", async () => {
    renderPage();
    await screen.findByText("Ljubica Azemi");

    fireEvent.click(screen.getAllByRole("button", { name: "Add entry" })[0]);
    fireEvent.change(screen.getByLabelText("NUI / Fiscal no. / Personal no."), { target: { value: "810123456" } });
    fireEvent.change(screen.getByLabelText("Business name / Person name"), { target: { value: "Acme LLC" } });
    fireEvent.change(screen.getByLabelText("Gross interest paid (4)"), { target: { value: "200" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add entry" })[1]);

    await waitFor(() => expect(withholdingTaxPOST).toHaveBeenCalledTimes(1));
    expect(withholdingTaxPOST.mock.calls[0][1]).toMatchObject({
      year: 2025,
      personalNumber: "810123456",
      name: "Acme LLC",
      grossInterest: 200,
      grossRent: 0,
      country: "Kosova",
    });
  });

  it("requires rental area and monthly rent once gross rent is entered", async () => {
    renderPage();
    await screen.findByText("Ljubica Azemi");

    fireEvent.click(screen.getAllByRole("button", { name: "Add entry" })[0]);
    fireEvent.change(screen.getByLabelText("NUI / Fiscal no. / Personal no."), { target: { value: "810123456" } });
    fireEvent.change(screen.getByLabelText("Business name / Person name"), { target: { value: "Landlord" } });
    fireEvent.change(screen.getByLabelText("Gross rent paid, excl. VAT (8)"), { target: { value: "500" } });

    expect(screen.getAllByRole("button", { name: "Add entry" })[1]).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Rented area, m2 (13)"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Gross monthly rent, excl. VAT (14)"), { target: { value: "500" } });

    expect(screen.getAllByRole("button", { name: "Add entry" })[1]).toBeEnabled();
  });

  it("lets the year be typed and updates the URL and the query once it is a valid year", async () => {
    renderPage();
    await screen.findByText("Ljubica Azemi");
    const input = screen.getByLabelText("Year") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "2" } });
    expect(input.value).toBe("2");
    fireEvent.change(input, { target: { value: "202" } });
    expect(input.value).toBe("202");
    expect(screen.getByTestId("location")).toHaveTextContent("year=2025");

    fireEvent.change(input, { target: { value: "2024" } });

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("year=2024"));
    expect(input.value).toBe("2024");
    await waitFor(() =>
      expect(withholdingTaxGET).toHaveBeenLastCalledWith("11111111-1111-1111-1111-111111111111", 2024, 1, 50, undefined, undefined),
    );
  });

  it("edits an entry through the generated client", async () => {
    renderPage();
    await screen.findByText("Ljubica Azemi");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const name = screen.getByLabelText("Business name / Person name") as HTMLInputElement;
    expect(name.value).toBe("Ljubica Azemi");
    fireEvent.change(name, { target: { value: "Ljubica A." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(withholdingTaxPUT).toHaveBeenCalledTimes(1));
    expect(withholdingTaxPUT.mock.calls[0][1]).toBe(fixture.items[0].id);
    expect(withholdingTaxPUT.mock.calls[0][2]).toMatchObject({ year: 2025, name: "Ljubica A.", grossRent: 100, rentalAreaM2: 29 });
  });

  it("deletes an entry after confirmation and not when declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    await screen.findByText("Ljubica Azemi");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(withholdingTaxDELETE).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(withholdingTaxDELETE).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", fixture.items[0].id),
    );
    confirm.mockRestore();
  });

  it("shows the empty state and disables export when the year has no entries", async () => {
    withholdingTaxGET.mockResolvedValue({ ...fixture, items: [], total: 0 });
    renderPage();

    expect(await screen.findByText("No entries for this year yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export ATK Excel/ })).toBeDisabled();
    expect(screen.queryByTestId("withholding-tax-totals")).not.toBeInTheDocument();
  });

  it("shows an error when the list fails to load", async () => {
    withholdingTaxGET.mockRejectedValue(new Error("boom"));
    renderPage();

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("exports the selected year through the generated client", async () => {
    withholdingTaxExport.mockResolvedValue({ data: new Blob(["x"]), status: 200, fileName: "tatimi-ne-burim-2025.xlsx" });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage();
    await screen.findByText("Ljubica Azemi");

    fireEvent.click(screen.getByRole("button", { name: /Export ATK Excel/ }));

    await waitFor(() => expect(withholdingTaxExport).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", 2025));
  });
});
