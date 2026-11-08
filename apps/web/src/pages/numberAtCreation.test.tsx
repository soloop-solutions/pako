import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PurchaseOrderDetail } from "@/pages/bills/PurchaseOrderDetail";
import { PriceChangeDetail } from "@/pages/inventory/PriceChangeDetail";
import { StockDocumentDetail } from "@/pages/inventory/StockDocumentDetail";

const m = vi.hoisted(() => ({
  preview: vi.fn(),
  getStockDocument: vi.fn(),
  getPurchaseOrder: vi.fn(),
  getPriceChange: vi.fn(),
  listWarehouses: vi.fn(),
  listPriceLists: vi.fn(),
  partnersAll: vi.fn(),
  taxes: vi.fn(),
  itemsGET: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...m } };
});
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111", activeCompany: { id: "11111111-1111-1111-1111-111111111111", name: "Demo" } }),
}));
vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const ID = "5b1f0c2e-1a11-4c01-9a08-000000000001";

function renderAt(path: string, route: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path={route} element={element} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.preview.mockResolvedValue({ number: "PREVIEW-9999", isProvisional: true });
  m.listWarehouses.mockResolvedValue([]);
  m.listPriceLists.mockResolvedValue([]);
  m.partnersAll.mockResolvedValue([]);
  m.taxes.mockResolvedValue([]);
  m.itemsGET.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
});

describe("a saved draft shows its own number, the preview is for new documents only", () => {
  it("stock document draft", async () => {
    m.getStockDocument.mockResolvedValue({ id: ID, type: 0, state: 0, number: "HAP-0007/2026", date: "2026-11-08", warehouseId: ID, warehouseName: "Main", notes: undefined, totalValue: 0, vatRepaymentDue: false, lines: [] });
    renderAt(`/stock-documents/${ID}`, "/stock-documents/:id", <StockDocumentDetail />);
    expect(await screen.findByText(/HAP-0007\/2026/)).toBeInTheDocument();
    expect(m.preview).not.toHaveBeenCalled();
    expect(screen.queryByText("PREVIEW-9999")).not.toBeInTheDocument();
  });

  it("stock document new shows the preview", async () => {
    renderAt("/stock-documents/new", "/stock-documents/:id", <StockDocumentDetail />);
    expect(await screen.findByText("PREVIEW-9999")).toBeInTheDocument();
    await waitFor(() => expect(m.preview).toHaveBeenCalledTimes(1));
  });

  it("purchase order draft", async () => {
    m.getPurchaseOrder.mockResolvedValue({ id: ID, partnerId: ID, partnerName: "Vendor", number: "PO-0003/2026", date: "2026-11-08", state: 0, progress: "", lines: [], bills: [] });
    renderAt(`/purchase-orders/${ID}`, "/purchase-orders/:id", <PurchaseOrderDetail />);
    expect(await screen.findByText(/PO-0003\/2026/)).toBeInTheDocument();
    expect(m.preview).not.toHaveBeenCalled();
    expect(screen.queryByText("PREVIEW-9999")).not.toBeInTheDocument();
  });

  it("purchase order new shows the preview", async () => {
    renderAt("/purchase-orders/new", "/purchase-orders/:id", <PurchaseOrderDetail />);
    expect(await screen.findByText("PREVIEW-9999")).toBeInTheDocument();
  });

  it("price change draft", async () => {
    m.getPriceChange.mockResolvedValue({ id: ID, priceListId: ID, priceListName: "Retail", state: 0, number: "NIV-0004/2026", date: "2026-11-08", totalDifference: 0, lines: [] });
    renderAt(`/price-changes/${ID}`, "/price-changes/:id", <PriceChangeDetail />);
    expect(await screen.findByText(/NIV-0004\/2026/)).toBeInTheDocument();
    expect(m.preview).not.toHaveBeenCalled();
  });

  it("price change new shows the preview", async () => {
    renderAt("/price-changes/new", "/price-changes/:id", <PriceChangeDetail />);
    expect(await screen.findByText("PREVIEW-9999")).toBeInTheDocument();
  });
});
