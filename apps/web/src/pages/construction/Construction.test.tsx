import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { SiteDetail } from "@/pages/construction/SiteDetail";

// docs/ERP_VERTICALS_PLAN.md §1 — a new construction site and a progress bill, against a mocked client.
const api = vi.hoisted(() => ({
  partnersAll: vi.fn(),
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
  getConstructionSite: vi.fn(),
  createConstructionSite: vi.fn(),
  listConstructionSites: vi.fn(),
  listProgressBills: vi.fn(),
  createProgressBill: vi.fn(),
  approveProgressBill: vi.fn(),
  invoiceProgressBill: vi.fn(),
  getSiteProgress: vi.fn(),
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

const SITE = {
  id: "s1", projectId: "pr1", projectCode: "K-001", name: "Banesat Arbëria", clientPartnerId: "p1", clientName: "Komuna e Prishtinës",
  address: undefined, contractValue: 100000, retentionPercent: 5, retentionReleased: 0, startDate: "2026-09-01", endDate: undefined, state: 1,
  billingItemId: "it1", boqTotal: 100000,
  costCodes: [{ id: "cc1", code: "01", name: "Betoni", budget: 40000 }],
  boq: [
    { id: "bq1", code: "1.1", description: "Gërmim", unit: "m3", quantity: 500, unitPrice: 20, amount: 10000, certified: 100 },
    { id: "bq2", code: "1.2", description: "Betonim", unit: "m3", quantity: 300, unitPrice: 300, amount: 90000, certified: 0 },
  ],
};

const billLine = (over: Record<string, unknown>) => ({
  id: "l1", boqLineId: "bq1", code: "1.1", description: "Gërmim", unit: "m3", contractQuantity: 500, unitPrice: 20,
  previousQuantity: 100, cumulativeQuantity: 250, periodQuantity: 150, amount: 3000, overContract: false, ...over,
});
const BILL = {
  id: "pb1", siteId: "s1", number: 2, periodTo: "2026-10-31", state: 0, amount: 3000, retention: 150, netDue: 2850, invoiceId: undefined,
  lines: [billLine({}), billLine({ id: "l2", boqLineId: "bq2", code: "1.2", description: "Betonim", contractQuantity: 300, unitPrice: 300, previousQuantity: 0, cumulativeQuantity: 0, periodQuantity: 0, amount: 0 })],
};

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/construction/:id" element={<SiteDetail />} />
            <Route path="/invoicing/:id" element={<p>invoice page</p>} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

async function pick(name: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.mouseDown(await screen.findByRole("option", { name: option }));
}

describe("Construction (P8)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.partnersAll.mockResolvedValue([{ id: "p1", name: "Komuna e Prishtinës", isCustomer: true, isVendor: false, taxNumber: undefined }]);
    api.itemsGET.mockResolvedValue({ items: [{ id: "it1", code: 501, name: "Punë ndërtimore", unit: "copë" }], total: 1, page: 1, pageSize: 200 });
    api.listConstructionSites.mockResolvedValue([]);
    api.getSiteProgress.mockResolvedValue(undefined);
  });

  it("creates a site with its project code, cost codes and bill of quantities", async () => {
    api.createConstructionSite.mockResolvedValue(SITE);
    api.getConstructionSite.mockResolvedValue(SITE);
    renderAt("/construction/new");

    fireEvent.change(screen.getByLabelText("Site"), { target: { value: "Banesat Arbëria" } });
    fireEvent.change(screen.getByLabelText("Project code"), { target: { value: "K-001" } });
    await pick("Client", "Komuna e Prishtinës");
    await pick("Billing item", "501 · Punë ndërtimore");
    fireEvent.change(screen.getByLabelText("Contract value (excl. VAT)"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Retention %"), { target: { value: "5" } });

    const code = within(screen.getAllByTestId("cost-code-row")[0]);
    fireEvent.change(code.getByLabelText("Code"), { target: { value: "01" } });
    fireEvent.change(code.getByLabelText("Name"), { target: { value: "Betoni" } });
    fireEvent.change(code.getByLabelText("Budget"), { target: { value: "40000" } });

    const boq = within(screen.getAllByTestId("boq-row")[0]);
    fireEvent.change(boq.getByLabelText("Code"), { target: { value: "1.1" } });
    fireEvent.change(boq.getByLabelText("Description"), { target: { value: "Gërmim" } });
    fireEvent.change(boq.getByLabelText("Unit"), { target: { value: "m3" } });
    fireEvent.change(boq.getByLabelText("Quantity"), { target: { value: "500" } });
    fireEvent.change(boq.getByLabelText("Unit price"), { target: { value: "20" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createConstructionSite).toHaveBeenCalled());
    expect(api.createConstructionSite.mock.calls[0][0]).toBe("c1");
    expect(api.createConstructionSite.mock.calls[0][1]).toEqual({
      name: "Banesat Arbëria", clientPartnerId: "p1", contractValue: 100000, retentionPercent: 5, billingItemId: "it1",
      costCodes: [{ code: "01", name: "Betoni", budget: 40000 }],
      boq: [{ code: "1.1", description: "Gërmim", unit: "m3", quantity: 500, unitPrice: 20 }],
      projectCode: "K-001", address: undefined, startDate: undefined, endDate: undefined, state: 0,
    });
    // The saved site opens, with the BoQ total from the API.
    expect(await screen.findByTestId("boq-total")).toHaveTextContent("100000.00");
  });

  it("sends the cumulative quantities of a draft progress bill, approves it and opens the invoice it creates", async () => {
    api.getConstructionSite.mockResolvedValue(SITE);
    api.listProgressBills.mockResolvedValue([]);
    api.createProgressBill.mockImplementation(() => {
      api.listProgressBills.mockResolvedValue([BILL]);
      return Promise.resolve(BILL);
    });
    renderAt("/construction/s1?tab=bills&bill=new");

    const editor = await screen.findByTestId("progress-bill-editor");
    fireEvent.change(within(editor).getByLabelText("Period to"), { target: { value: "2026-10-31" } });
    // A new bill starts from the certified quantity.
    expect(within(editor).getByLabelText("Cumulative quantity 1.1")).toHaveValue("100");
    fireEvent.change(within(editor).getByLabelText("Cumulative quantity 1.1"), { target: { value: "250" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(api.createProgressBill).toHaveBeenCalled());
    expect(api.createProgressBill.mock.calls[0]).toEqual(["c1", "s1", {
      periodTo: "2026-10-31",
      lines: [{ boqLineId: "bq1", cumulativeQuantity: 250 }, { boqLineId: "bq2", cumulativeQuantity: 0 }],
    }]);
    // The period quantity, amount and totals are the API's.
    const totals = await screen.findByTestId("pb-totals");
    expect(totals).toHaveTextContent("3000.00");
    expect(totals).toHaveTextContent("2850.00");

    api.approveProgressBill.mockImplementation(() => {
      const approved = { ...BILL, state: 1 };
      api.listProgressBills.mockResolvedValue([approved]);
      return Promise.resolve(approved);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveProgressBill).toHaveBeenCalledWith("c1", "pb1"));

    api.invoiceProgressBill.mockResolvedValue("inv9");
    fireEvent.click(await screen.findByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(api.invoiceProgressBill).toHaveBeenCalledWith("c1", "pb1"));
    expect(await screen.findByText("invoice page")).toBeInTheDocument();
  });
});
