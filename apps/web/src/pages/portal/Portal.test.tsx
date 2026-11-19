import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PortalCart } from "@/pages/portal/PortalCart";
import { PortalCatalogue } from "@/pages/portal/PortalCatalogue";
import { PortalInvoices } from "@/pages/portal/PortalInvoices";
import { PortalLayout } from "@/pages/portal/PortalLayout";
import { PortalOrderDetail } from "@/pages/portal/PortalOrders";

configure({ asyncUtilTimeout: 5000 });

const api = vi.hoisted(() => ({
  listPortalCompanies: vi.fn(),
  getPortalSummary: vi.fn(),
  listPortalCategories: vi.fn(),
  listPortalCatalogue: vi.fn(),
  pricePortalCart: vi.fn(),
  placePortalOrder: vi.fn(),
  getPortalOrder: vi.fn(),
  cancelPortalOrder: vi.fn(),
  listPortalOrders: vi.fn(),
  listPortalInvoices: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  const mocked = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]));
  return { ...actual, apiClient: { ...actual.apiClient, ...mocked } };
});
const logout = vi.fn();
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ auth: { userId: "u1" }, logout }) }));

const COMPANY = { companyId: "c1", companyName: "Shpërndarja Drini", partnerId: "p1", partnerName: "Market Arbeni", logoUrl: undefined };
const ITEM = {
  itemId: "i1", code: "A1", name: "Ujë 0.5L", description: undefined, categoryId: undefined, categoryName: "Pije", unit: "copë",
  price: 16, discountPercent: 10, priceAfterDiscount: 14.4, inStock: true, units: [{ unitName: "Pako", factor: 6, price: 96 }],
};
const PRICED = {
  lines: [{ itemId: "i1", description: "Ujë 0.5L", quantity: 2, unitName: "copë", unitPrice: 16, discountPercent: 10, net: 24.41, vat: 4.39, gross: 28.8 }],
  net: 24.41, vat: 4.39, gross: 28.8,
};
const ORDER = {
  id: "o1", reference: "WEB-1A2B3C4D", number: undefined, date: "2026-11-19", deliveryDate: undefined, status: "Submitted",
  customerReference: "PO-7", deliveryAddress: undefined, notes: undefined, createdAt: "2026-11-19T09:00:00Z", canCancel: true,
  lines: PRICED.lines, net: 24.41, vat: 4.39, gross: 28.8, invoices: [],
};

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname}</span>;
}

function renderPortal(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/portal" element={<PortalLayout />}>
              <Route index element={<PortalCatalogue />} />
              <Route path="cart" element={<PortalCart />} />
              <Route path="orders/:id" element={<PortalOrderDetail />} />
              <Route path="invoices" element={<PortalInvoices />} />
            </Route>
            <Route path="*" element={null} />
          </Routes>
          <Where />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  api.listPortalCompanies.mockResolvedValue([COMPANY]);
  api.getPortalSummary.mockResolvedValue({
    companyId: "c1", companyName: COMPANY.companyName, partnerId: "p1", partnerName: "Market Arbeni",
    outstanding: 120.5, overdue: 20, openOrders: 1, creditLimit: 1000, available: 879.5, overdueBlocked: false,
  });
  api.listPortalCategories.mockResolvedValue([]);
  api.listPortalCatalogue.mockResolvedValue({ items: [ITEM], total: 1, page: 1, pageSize: 50 });
  api.pricePortalCart.mockResolvedValue(PRICED);
});

describe("Customer portal", () => {
  it("shows the customer's balance and the catalogue at the API's prices", async () => {
    renderPortal("/portal");
    expect(await screen.findByText("Ujë 0.5L")).toBeInTheDocument();
    expect(screen.getByText("Ordering as Market Arbeni")).toBeInTheDocument();
    const balance = screen.getByTestId("portal-balance");
    expect(within(balance).getByText("120.50")).toBeInTheDocument();
    expect(within(balance).getByText("20.00")).toBeInTheDocument();
    expect(within(balance).getByText("879.50")).toBeInTheDocument();
    expect(screen.getByText("16.00")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("14.40")).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();
    expect(api.listPortalCatalogue).toHaveBeenCalledWith("c1", undefined, undefined, 1, 50);
  });

  it("adds to the cart, prices it on the server and sends only items and quantities", async () => {
    api.placePortalOrder.mockResolvedValue(ORDER);
    api.getPortalOrder.mockResolvedValue(ORDER);
    renderPortal("/portal");
    fireEvent.change(await screen.findByLabelText("Quantity of Ujë 0.5L"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Ujë 0.5L to the cart" }));
    expect(await screen.findByRole("link", { name: /Cart \(1\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Cart \(1\)/ }));
    expect(await screen.findByTestId("portal-cart-totals")).toHaveTextContent("Net 24.41 · VAT 4.39");
    expect(api.pricePortalCart).toHaveBeenCalledWith("c1", { lines: [{ itemId: "i1", quantity: 2, unitName: undefined }] });

    fireEvent.change(screen.getByLabelText(/^Your reference/), { target: { value: "PO-7" } });
    fireEvent.click(screen.getByRole("button", { name: "Send order (28.80)" }));
    await waitFor(() => expect(api.placePortalOrder).toHaveBeenCalledWith("c1", {
      lines: [{ itemId: "i1", quantity: 2, unitName: undefined }],
      customerReference: "PO-7", deliveryDate: undefined, deliveryAddress: undefined, notes: undefined,
    }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/portal/orders/o1"));
    expect(sessionStorage.getItem("pako.portalCart.c1")).toBe("[]");
  });

  it("lets the customer withdraw an order the company has not answered", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.getPortalOrder.mockResolvedValue(ORDER);
    api.cancelPortalOrder.mockResolvedValue({ ...ORDER, status: "Cancelled", canCancel: false });
    renderPortal("/portal/orders/o1");
    expect(await screen.findByText("Order WEB-1A2B3C4D")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw order" }));
    await waitFor(() => expect(api.cancelPortalOrder).toHaveBeenCalledWith("c1", "o1"));
  });

  it("hides withdrawing once the order is confirmed", async () => {
    api.getPortalOrder.mockResolvedValue({ ...ORDER, status: "Confirmed", canCancel: false, number: "SO-0004", reference: "SO-0004" });
    renderPortal("/portal/orders/o1");
    expect(await screen.findByText("Order SO-0004")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw order" })).not.toBeInTheDocument();
  });

  it("lists invoices with what is still open and flags the overdue ones", async () => {
    api.listPortalInvoices.mockResolvedValue({
      items: [
        { id: "v1", number: "INV-0010", kind: "Invoice", issueDate: "2026-10-01", dueDate: "2026-10-31", gross: 200, open: 75.25, overdue: true },
        { id: "v2", number: "INV-0011", kind: "Invoice", issueDate: "2026-11-01", dueDate: "2026-12-01", gross: 50, open: 0, overdue: false },
        { id: "v3", number: "CN-0001", kind: "CreditNote", issueDate: "2026-11-02", dueDate: "2026-11-02", gross: -10, open: undefined, overdue: false },
      ],
      total: 3, page: 1, pageSize: 50,
    });
    renderPortal("/portal/invoices");
    expect(await screen.findByText("INV-0010")).toBeInTheDocument();
    expect(screen.getByText("75.25")).toBeInTheDocument();
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Credit note")).toBeInTheDocument();
  });

  it("explains when the login is no customer's portal contact", async () => {
    api.listPortalCompanies.mockResolvedValue([]);
    renderPortal("/portal");
    expect(await screen.findByText("No customer portal")).toBeInTheDocument();
    expect(api.listPortalCatalogue).not.toHaveBeenCalled();
  });
});
