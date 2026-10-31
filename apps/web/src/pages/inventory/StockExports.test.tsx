import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { ItemCardPanel } from "@/pages/inventory/ItemCardDialog";
import { StockLevels } from "@/pages/inventory/StockLevels";
import { StockReports } from "@/pages/inventory/StockReports";

const COMPANY = "11111111-1111-1111-1111-111111111111";

const m = vi.hoisted(() => ({
  listWarehouses: vi.fn(),
  listItemCategories: vi.fn(),
  listStockLevels: vi.fn(),
  getStockValuation: vi.fn(),
  getItemCard: vi.fn(),
  stockLevelsExport: vi.fn(),
  stockValuationExport: vi.fn(),
  itemCardExport: vi.fn(),
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

function renderWith(children: ReactNode, entry = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

const file = { data: new Blob(["x"]), status: 200, fileName: "x.xlsx" };

describe("Export buttons on the stock reports", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.listWarehouses.mockResolvedValue([]);
    m.listItemCategories.mockResolvedValue([]);
    m.listStockLevels.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    m.getStockValuation.mockResolvedValue({ asOf: "2026-10-31", stockValue: 0, ledgerValue: 0, difference: 0, writeDownAllowance: 0, netValue: 0, items: [], accounts: [] });
    m.getItemCard.mockResolvedValue({ openingQuantity: 0, openingValue: 0, closingQuantity: 0, closingValue: 0, rows: [] });
    m.stockLevelsExport.mockResolvedValue(file);
    m.stockValuationExport.mockResolvedValue(file);
    m.itemCardExport.mockResolvedValue(file);
  });

  it("stock levels exports with the page's current filters", async () => {
    renderWith(<StockLevels />, "/stock?warehouse=wh1&category=cat1&low=1&stock-levels.q=lap");
    await waitFor(() => expect(m.listStockLevels).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.stockLevelsExport).toHaveBeenCalledWith(COMPANY, "lap", "wh1", "cat1", true));
  });

  it("stock levels exports unfiltered by default", async () => {
    renderWith(<StockLevels />);
    fireEvent.click(await screen.findByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.stockLevelsExport).toHaveBeenCalledWith(COMPANY, undefined, undefined, undefined, false));
  });

  it("valuation exports with its as-of date", async () => {
    renderWith(<StockReports />, "/stock-reports?asOf=2026-09-30");
    await waitFor(() => expect(m.getStockValuation).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.stockValuationExport).toHaveBeenCalledWith(COMPANY, "2026-09-30"));
  });

  it("item card exports with the dialog's period", async () => {
    renderWith(<ItemCardPanel itemId="item-1" />);
    fireEvent.change(await screen.findByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.itemCardExport).toHaveBeenCalledWith(COMPANY, "item-1", "2026-03-01", "2026-03-31"));
  });

  it("item card exports an open period as undefined dates", async () => {
    renderWith(<ItemCardPanel itemId="item-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Export to Excel" }));
    await waitFor(() => expect(m.itemCardExport).toHaveBeenCalledWith(COMPANY, "item-1", undefined, undefined));
  });
});
