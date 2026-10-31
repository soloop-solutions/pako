import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { ItemCardDialog } from "@/pages/inventory/ItemCardDialog";
import { StockReports } from "@/pages/inventory/StockReports";

const m = vi.hoisted(() => ({
  getStockValuation: vi.fn(),
  getItemCard: vi.fn(),
  listWarehouses: vi.fn(),
  listItemCategories: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const ITEM = "3f1d2c4e-6a7b-4c8d-9e0f-1a2b3c4d5e01";
const BILL = "5b1f0c2e-1a11-4c01-9a05-000000000001";
const INVOICE = "5b1f0c2e-1a11-4c01-9a06-000000000001";
const DOC = "5b1f0c2e-1a11-4c01-9a08-000000000001";

function Probe() {
  const location = useLocation();
  return <div data-testid="route">{location.pathname + location.search}</div>;
}

function renderAt(entry: string, element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/stock" element={element} />
            <Route path="/stock-reports" element={element} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
          <Probe />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

const route = () => screen.getByTestId("route").textContent;

function cardRow(moveId: string, reference: string, sourceType: number, sourceId: string) {
  return { moveId, date: "2026-03-05", kind: 0, sourceType, sourceId, reference, fromLocation: "A", toLocation: "B", quantityIn: 1, quantityOut: 0, unitCost: 1, value: 1, qtyAfter: 1, avgCostAfter: 1, valueAfter: 1 };
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.listWarehouses.mockResolvedValue([]);
  m.listItemCategories.mockResolvedValue([]);
  m.getStockValuation.mockResolvedValue({
    asOf: "2026-10-31",
    stockValue: 2250,
    ledgerValue: 2250,
    difference: 0,
    writeDownAllowance: 0,
    netValue: 2250,
    accounts: [],
    items: [{ itemId: ITEM, itemCode: 1, itemName: "Laptop", unit: "pc", quantity: 15, averageCost: 150, value: 2250 }],
  });
  m.getItemCard.mockResolvedValue({
    openingQuantity: 0,
    openingValue: 0,
    closingQuantity: 3,
    closingValue: 3,
    rows: [
      cardRow("m1", "BILL-IN", 0, BILL),
      cardRow("m2", "INV-OUT", 1, INVOICE),
      cardRow("m3", "STK-DOC", 2, DOC),
      cardRow("m4", "UNKNOWN-SRC", 9, DOC),
    ],
  });
});

describe("stock valuation items", () => {
  it("a row opens the item", async () => {
    renderAt("/stock-reports", <StockReports />);
    fireEvent.click(await screen.findByText("Laptop"));
    expect(route()).toBe(`/items?open=${ITEM}`);
  });
});

describe("item card rows", () => {
  const dialog = <ItemCardDialog itemId={ITEM} title="1 · Laptop" onClose={() => {}} />;

  it.each([
    ["BILL-IN", `/bills/${BILL}`],
    ["INV-OUT", `/invoicing/${INVOICE}`],
    ["STK-DOC", `/stock-documents/${DOC}`],
  ])("%s opens its source and the dialog goes away with the route", async (reference, path) => {
    renderAt("/stock", dialog);
    fireEvent.click(await screen.findByText(reference));
    expect(route()).toBe(path);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("elsewhere")).toBeInTheDocument();
  });

  it("a move with an unknown source type stays inert", async () => {
    renderAt("/stock", dialog);
    const cell = await screen.findByText("UNKNOWN-SRC");
    expect((cell.closest("tr") as HTMLElement).className).not.toContain("cursor-pointer");
    fireEvent.click(cell);
    expect(route()).toBe("/stock");
  });
});
