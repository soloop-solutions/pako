import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Partners } from "@/pages/partners/Partners";

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

const ACME = {
  id: "partner-1",
  name: "Acme Corp",
  taxNumber: "123456789",
  isCustomer: true,
  isVendor: false,
  fiscalNumber: undefined,
  isVatRegistered: true,
  receivableAccountId: "acc-ar",
  payableAccountId: undefined,
  paymentTermDays: 30,
  creditLimit: 5000,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Partners />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

function renderPageInStrictMode() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <MemoryRouter>
        <IntlProviderWrapper>
          <QueryClientProvider client={queryClient}>
            <Partners />
          </QueryClientProvider>
        </IntlProviderWrapper>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("Partners", () => {
  beforeEach(() => {
    partnersAll.mockReset();
    accountsAll.mockReset();
    partnersCreate.mockReset();
    partnersUpdate.mockReset();
    partnersAll.mockResolvedValue([ACME]);
    accountsAll.mockResolvedValue([RECEIVABLE_ACCOUNT, PAYABLE_ACCOUNT]);
  });

  it("lists a partner with account, terms and credit limit fields", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    expect(screen.getByText("123456789")).toBeInTheDocument();
    expect(screen.getByText(/110100/)).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("5000.00 \u20AC")).toBeInTheDocument();
  });

  it("edits a partner via the real PUT and closes the form on success", async () => {
    partnersUpdate.mockResolvedValue({ ...ACME, creditLimit: 9000 });
    renderPage();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    const row = screen.getByText("Acme Corp").closest("tr");
    if (!row) throw new Error("row not found");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const creditLimitInput = await screen.findByLabelText("Credit limit");
    fireEvent.change(creditLimitInput, { target: { value: "9000" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(partnersUpdate).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText("Credit limit")).not.toBeInTheDocument());
  });

  it("creates a partner via the real POST", async () => {
    partnersCreate.mockResolvedValue({ ...ACME, id: "partner-2", name: "New Co" });

    renderPage();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add partner" }));

    const nameInputs = await screen.findAllByLabelText("Name");
    fireEvent.change(nameInputs[nameInputs.length - 1], { target: { value: "New Co" } });

    const creditLimitInputs = screen.getAllByLabelText("Credit limit");
    fireEvent.change(creditLimitInputs[creditLimitInputs.length - 1], { target: { value: "1200" } });

    const submitButtons = screen.getAllByRole("button", { name: "Add partner" });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => expect(partnersCreate).toHaveBeenCalled());
  });

  it("still loads correctly after a StrictMode double-mount", async () => {
    renderPageInStrictMode();

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
  });
});
