import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { BuildingDetail } from "@/pages/realestate/BuildingDetail";
import { SaleContractDetail } from "@/pages/realestate/SaleContractDetail";

// docs/ERP_VERTICALS_PLAN.md §2 — the unit board, a sale contract with a generated plan, and
// invoicing picked installments, against a mocked client.
const api = vi.hoisted(() => ({
  partnersAll: vi.fn(),
  listBuildings: vi.fn(),
  listPropertyUnits: vi.fn(),
  listUnitReservations: vi.fn(),
  createUnitSaleContract: vi.fn(),
  getUnitSaleContract: vi.fn(),
  invoiceInstallments: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      ...Object.fromEntries(Object.keys(api).map((k) => [k, (...args: unknown[]) => api[k as keyof typeof api](...args)])),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "c1", activeCompany: { name: "Ndërtimi SHPK" } }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const BUILDING = { id: "b1", projectId: "pr1", projectCode: "N-01", name: "Lamela A", address: undefined, saleItemId: "it1", units: 2, available: 1, reserved: 0, sold: 1, rented: 0 };
const unit = (over: Record<string, unknown>) => ({
  id: "u1", buildingId: "b1", buildingName: "Lamela A", number: "A-12", floor: "3", kind: 0, area: 85, listPrice: 102000, state: 0,
  pricePerSquareMetre: 1200, holderName: undefined, ...over,
});
const installment = (n: number, over: Record<string, unknown> = {}) => ({
  id: `i${n}`, number: n, dueDate: `2026-${String(9 + n).padStart(2, "0")}-01`, amount: 10000, invoiceId: undefined, invoiceNumber: undefined, open: 0, overdue: false, ...over,
});
const CONTRACT = {
  id: "k1", number: "KS-0001", unitId: "u1", unitNumber: "A-12", buildingName: "Lamela A", buyerPartnerId: "p1", buyerName: "Arben Gashi", kind: 0,
  contractDate: "2026-10-01", price: 102000, state: 0, notes: undefined, invoiced: 22000, paid: 12000, outstanding: 90000, overdue: 10000,
  installments: [
    installment(1, { amount: 22000, invoiceId: "inv1", invoiceNumber: "INV-0101", open: 10000, overdue: true }),
    installment(2), installment(3),
  ],
};

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/real-estate/buildings/:id" element={<BuildingDetail />} />
            <Route path="/real-estate/contracts/:id" element={<SaleContractDetail />} />
            <Route path="/invoicing/:id" element={<p>invoice page</p>} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Real estate (P8)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.partnersAll.mockResolvedValue([{ id: "p1", name: "Arben Gashi", isCustomer: true, isVendor: false, taxNumber: undefined }]);
    api.listBuildings.mockResolvedValue([BUILDING]);
    api.listPropertyUnits.mockResolvedValue([unit({}), unit({ id: "u2", number: "A-13", state: 2, holderName: "Besa Krasniqi" })]);
    api.listUnitReservations.mockResolvedValue([]);
  });

  it("draws the unit board and sells a unit with a generated installment plan", async () => {
    api.createUnitSaleContract.mockResolvedValue(CONTRACT);
    api.getUnitSaleContract.mockResolvedValue(CONTRACT);
    renderAt("/real-estate/buildings/b1");

    const cards = await screen.findAllByTestId("unit-card");
    expect(cards).toHaveLength(2);
    expect(cards[1]).toHaveTextContent("Besa Krasniqi");
    expect(api.listPropertyUnits).toHaveBeenCalledWith("c1", "b1", undefined);

    fireEvent.click(cards[0]);
    const unitDialog = await screen.findByRole("dialog");
    fireEvent.click(within(unitDialog).getByRole("button", { name: "Sell" }));

    const dialog = await screen.findByRole("dialog", { name: /Sale contract/ });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Buyer" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Arben Gashi" }));
    fireEvent.change(within(dialog).getByLabelText("Contract date"), { target: { value: "2026-10-01" } });
    expect(within(dialog).getByLabelText("Price")).toHaveValue("102000");
    fireEvent.change(within(dialog).getByLabelText("Down payment"), { target: { value: "22000" } });
    fireEvent.change(within(dialog).getByLabelText("Monthly installments"), { target: { value: "8" } });
    fireEvent.change(within(dialog).getByLabelText("First installment"), { target: { value: "2026-11-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create contract" }));

    await waitFor(() => expect(api.createUnitSaleContract).toHaveBeenCalled());
    expect(api.createUnitSaleContract.mock.calls[0]).toEqual(["c1", {
      unitId: "u1", buyerPartnerId: "p1", contractDate: "2026-10-01", price: 102000, kind: 0, reservationId: undefined, notes: undefined,
      downPayment: 22000, installmentCount: 8, firstInstallment: "2026-11-01",
    }]);
    // The new contract opens.
    expect(await screen.findByRole("heading", { name: /KS-0001/ })).toBeInTheDocument();
  });

  it("invoices the picked installments and opens the draft invoice", async () => {
    api.getUnitSaleContract.mockResolvedValue(CONTRACT);
    api.invoiceInstallments.mockResolvedValue("inv5");
    renderAt("/real-estate/contracts/k1");

    expect(await screen.findByTestId("installment-overdue")).toBeInTheDocument();
    // An installment already invoiced can't be picked again.
    expect(screen.queryByRole("checkbox", { name: "Pick installment 1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick installment 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick installment 3" }));
    fireEvent.change(screen.getByLabelText("Invoice date"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice (2)" }));

    await waitFor(() => expect(api.invoiceInstallments).toHaveBeenCalled());
    expect(api.invoiceInstallments.mock.calls[0]).toEqual(["c1", "k1", { installmentIds: ["i2", "i3"], issueDate: "2026-11-01" }]);
    expect(await screen.findByText("invoice page")).toBeInTheDocument();
  });
});
