import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Vendors } from "@/pages/partners/Vendors";

const partnersAll = vi.fn();
const accountsAll = vi.fn();
const partnersCreate = vi.fn();
const partnersUpdate = vi.fn();

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      partnersAll: (...args: unknown[]) => partnersAll(...args),
      accountsAll: (...args: unknown[]) => accountsAll(...args),
      partnersPOST: (...args: unknown[]) => partnersCreate(...args),
      partnersPUT: (...args: unknown[]) => partnersUpdate(...args),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: "11111111-1111-1111-1111-111111111111" }),
}));

const RECEIVABLE_ACCOUNT = { id: "acc-ar", code: "110100", name: "Trade Receivables", accountType: 0, accountSubType: 0, parentAccountId: undefined, isReconcilable: false };
const PAYABLE_ACCOUNT = { id: "acc-ap", code: "200100", name: "Trade Payables", accountType: 1, accountSubType: 0, parentAccountId: undefined, isReconcilable: false };

const CUSTOMER_ONLY = {
  id: "partner-1",
  name: "Customer Corp",
  taxNumber: "111111111",
  isCustomer: true,
  isVendor: false,
  fiscalNumber: undefined,
  isVatRegistered: true,
  receivableAccountId: "acc-ar",
  payableAccountId: undefined,
  paymentTermDays: 30,
  creditLimit: 5000,
};

const VENDOR_ONLY = {
  id: "partner-2",
  name: "Vendor LLC",
  taxNumber: "222222222",
  isCustomer: false,
  isVendor: true,
  fiscalNumber: undefined,
  isVatRegistered: false,
  receivableAccountId: undefined,
  payableAccountId: "acc-ap",
  paymentTermDays: 15,
  creditLimit: undefined,
};

const DUAL_ROLE = {
  id: "partner-3",
  name: "Both Inc",
  taxNumber: "333333333",
  isCustomer: true,
  isVendor: true,
  fiscalNumber: "F123",
  isVatRegistered: true,
  receivableAccountId: "acc-ar",
  payableAccountId: "acc-ap",
  paymentTermDays: 45,
  creditLimit: 10000,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Vendors />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Vendors", () => {
  beforeEach(() => {
    partnersAll.mockReset();
    accountsAll.mockReset();
    partnersCreate.mockReset();
    partnersUpdate.mockReset();
    partnersAll.mockResolvedValue([CUSTOMER_ONLY, VENDOR_ONLY, DUAL_ROLE]);
    accountsAll.mockResolvedValue([RECEIVABLE_ACCOUNT, PAYABLE_ACCOUNT]);
  });

  it("shows only vendors and dual-role partners, hides customer-only", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Vendor LLC")).toBeInTheDocument());
    expect(screen.getByText("Both Inc")).toBeInTheDocument();
    expect(screen.queryByText("Customer Corp")).not.toBeInTheDocument();
  });

  it("displays the Vendors page title", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Vendors")).toBeInTheDocument());
  });

  it("creates a vendor with isVendor pre-selected", async () => {
    partnersCreate.mockResolvedValue({ ...VENDOR_ONLY, id: "partner-new", name: "New Vendor" });

    renderPage();
    await waitFor(() => expect(screen.getByText("Vendor LLC")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New vendor" }));

    const nameInputs = await screen.findAllByLabelText(/^Name/);
    fireEvent.change(nameInputs[nameInputs.length - 1], { target: { value: "New Vendor" } });

    const submitButtons = screen.getAllByRole("button", { name: "New vendor" });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => expect(partnersCreate).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.objectContaining({ name: "New Vendor", isVendor: true }),
    ));
  });

  it("edits a vendor via the real PUT endpoint", async () => {
    partnersUpdate.mockResolvedValue({ ...VENDOR_ONLY, paymentTermDays: 60 });

    renderPage();
    await waitFor(() => expect(screen.getByText("Vendor LLC")).toBeInTheDocument());

    const row = screen.getByText("Vendor LLC").closest("tr");
    if (!row) throw new Error("row not found");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const termInput = await screen.findByLabelText("Payment terms (days)");
    fireEvent.change(termInput, { target: { value: "60" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(partnersUpdate).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "partner-2",
      expect.objectContaining({ paymentTermDays: 60 }),
    ));
  });

  it("dual-role partner shows 'Also customer' badge instead of type column", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Both Inc")).toBeInTheDocument());
    const row = screen.getByText("Both Inc").closest("tr");
    if (!row) throw new Error("row not found");
    expect(within(row).getByText("Also customer")).toBeInTheDocument();
  });

  it("vendor-only partner does not show 'Also customer' badge", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Vendor LLC")).toBeInTheDocument());
    const row = screen.getByText("Vendor LLC").closest("tr");
    if (!row) throw new Error("row not found");
    expect(within(row).queryByText("Also customer")).not.toBeInTheDocument();
  });
});
