import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePaymentRequest, OpenDocumentResponse, PaymentResponse } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PaymentsPage } from "@/pages/bank/PaymentsPage";
import { chooseOption } from "@/test/chooseOption";

const companyId = "11111111-1111-1111-1111-111111111111";

const payment: PaymentResponse = {
  id: "p1", direction: "Inbound", partnerId: "c1", partnerName: "Market Viva", amount: 300, date: "2026-11-20",
  reference: "Advance", state: "Posted", invoiceId: undefined, billId: undefined, documentNumber: undefined,
  destinationAccountId: "a1", destinationAccountName: "101001 Bank", bankStatementLineId: undefined,
  createdAt: "2026-11-20T10:00:00Z", unapplied: 300, appliedCount: 0, canCancel: true,
};

const openDocuments = (amount?: number): OpenDocumentResponse[] => [
  { documentId: "i-old", kind: "Invoice", documentType: "Invoice", number: "INV-0001", issueDate: "2026-09-01", dueDate: "2026-10-01", total: 100, outstanding: 100, suggested: amount ? 100 : 0 },
  { documentId: "i-new", kind: "Invoice", documentType: "Invoice", number: "INV-0002", issueDate: "2026-10-01", dueDate: "2026-11-01", total: 250, outstanding: 250, suggested: amount ? Math.min(250, amount - 100) : 0 },
];

const createMock = vi.fn(async (_c: string, body: CreatePaymentRequest) => ({ ...payment, amount: body.amount }));
const applyMock = vi.fn(async () => ({ ...payment, unapplied: 0, appliedCount: 2 }));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      payments: async () => ({ items: [payment], total: 1, page: 1, pageSize: 50 }),
      listPaymentOpenDocuments: async (_c: string, _p: string, _d: string, amount?: number) => openDocuments(amount),
      paymentMethodsAll: async () => [{ id: "m1", name: "Banka ProCredit", kind: 1, ledgerAccountId: "a1", isActive: true }],
      partnersAll: async () => [
        { id: "c1", name: "Market Viva", isCustomer: true, isVendor: false },
        { id: "v1", name: "Furnitori X", isCustomer: false, isVendor: true },
      ],
      createPayment: (c: string, body: CreatePaymentRequest) => createMock(c, body),
      applyPayment: () => applyMock(),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: companyId, activeCompany: { id: companyId, name: "Test Co" } }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isAdmin: true }, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/payments"]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <PaymentsPage />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Payments page: direct payments", () => {
  beforeEach(() => {
    createMock.mockClear();
    applyMock.mockClear();
  });

  it("records money received with no invoice, applying it oldest first", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New payment" }));
    const dialog = await screen.findByRole("dialog");

    await chooseOption(within(dialog).getByRole("combobox", { name: "Customer" }), "Market Viva");
    fireEvent.change(within(dialog).getByLabelText(/Amount/), { target: { value: "200" } });

    expect(await within(dialog).findByText("INV-0001")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Oldest first" }));
    await waitFor(() => expect(within(dialog).getByRole("spinbutton", { name: /Apply INV-0002/ })).toHaveValue(100));
    fireEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const body = createMock.mock.calls[0][1];
    expect(body).toMatchObject({ direction: "Inbound", partnerId: "c1", amount: 200, cashOrBankAccountId: "a1" });
    expect(body.allocations).toEqual([
      { invoiceId: "i-old", billId: undefined, amount: 100 },
      { invoiceId: "i-new", billId: undefined, amount: 100 },
    ]);
  });

  it("shows what a payment has not applied and applies it from the row", async () => {
    renderPage();
    expect(await screen.findByText("Market Viva")).toBeInTheDocument();
    expect(screen.getByText("Unapplied")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Market Viva: 300\.00 not yet applied/)).toBeInTheDocument();
    fireEvent.change(await within(dialog).findByRole("spinbutton", { name: /Apply INV-0001/ }), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(applyMock).toHaveBeenCalled());
  });
});
