import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { LeaseDetail } from "@/pages/rentals/LeaseDetail";
import { RentRun } from "@/pages/rentals/RentRun";

// docs/ERP_VERTICALS_PLAN.md §3 — the monthly rent run and a meter reading, against a mocked client.
const api = vi.hoisted(() => ({
  partnersAll: vi.fn(),
  itemsGET: vi.fn(),
  itemsGET2: vi.fn(),
  listPropertyUnits: vi.fn(),
  runRent: vi.fn(),
  invoicesGET: vi.fn(),
  getLease: vi.fn(),
  readLeaseMeter: vi.fn(),
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
  useCompany: () => ({ activeCompanyId: "c1", activeCompany: { name: "Prona SHPK" } }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: null, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true, canApprove: () => true }),
}));

const invoice = (id: string, number: string | undefined, partnerId: string) => ({
  id, partnerId, invoiceNumber: number, issueDate: "2026-10-01", dueDate: "2026-10-05", state: "Draft", documentType: 0,
  originalInvoiceId: undefined, journalEntryId: undefined, internalNotes: undefined, priceMode: 0, paymentTermDays: undefined, graceDays: undefined,
  lines: [{ id: `${id}-l`, description: "Qiraja tetor 2026" }],
});

const LEASE = {
  id: "l1", number: "QR-0001", unitId: undefined, unitLabel: undefined, property: "Lokali në rr. Agim Ramadani 12", tenantPartnerId: "p1",
  tenantName: "Kafeteria Hana", startDate: "2026-01-01", endDate: undefined, rent: 600, rentItemId: "rent", dueDay: 5, deposit: 1200,
  depositReceivedOn: "2026-01-01", depositReturnedOn: undefined, state: 1, notes: undefined, lastInvoicedPeriod: "2026-09-01", arrears: 600,
  meters: [{ id: "m1", name: "Rryma", itemId: "kwh", itemName: "Energji elektrike (kWh)", lastReading: 1000, pendingReading: undefined }],
};

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/rentals/rent-run" element={<RentRun />} />
            <Route path="/rentals/leases/:id" element={<LeaseDetail />} />
            <Route path="/invoicing/:id" element={<p>invoice page</p>} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Rentals (P8)", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.partnersAll.mockResolvedValue([
      { id: "p1", name: "Kafeteria Hana", isCustomer: true, isVendor: false },
      { id: "p2", name: "Zyra Ligjore Berisha", isCustomer: true, isVendor: false },
    ]);
    api.itemsGET.mockResolvedValue({ items: [{ id: "rent", code: 900, name: "Qira", unit: "muaj" }], total: 1, page: 1, pageSize: 200 });
    api.itemsGET2.mockResolvedValue({ id: "kwh", code: 901, name: "Energji elektrike (kWh)", unit: "kWh" });
    api.listPropertyUnits.mockResolvedValue([]);
  });

  it("runs the rent for the chosen month and lists the invoices it created", async () => {
    api.runRent.mockResolvedValue({ period: "2026-10-01", invoiceIds: ["inv1", "inv2"], created: 2, alreadyInvoiced: 1, notRunning: 3 });
    api.invoicesGET.mockImplementation((_c: string, id: string) => Promise.resolve(id === "inv1" ? invoice("inv1", undefined, "p1") : invoice("inv2", undefined, "p2")));
    renderAt("/rentals/rent-run?month=2026-09");

    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(api.runRent).toHaveBeenCalledWith("c1", { month: "2026-10-01" }));
    expect(await screen.findByTestId("rent-created")).toHaveTextContent("2");
    expect(screen.getByTestId("rent-already")).toHaveTextContent("1");
    expect(screen.getByTestId("rent-not-running")).toHaveTextContent("3");
    expect(await screen.findByText("Kafeteria Hana")).toBeInTheDocument();
    expect(screen.getByText("Zyra Ligjore Berisha")).toBeInTheDocument();
    expect(api.invoicesGET).toHaveBeenCalledWith("c1", "inv1");
    expect(api.invoicesGET).toHaveBeenCalledWith("c1", "inv2");

    fireEvent.click(screen.getByText("Zyra Ligjore Berisha"));
    expect(await screen.findByText("invoice page")).toBeInTheDocument();
  });

  it("sends a meter reading for a running lease", async () => {
    api.getLease.mockResolvedValue(LEASE);
    api.readLeaseMeter.mockResolvedValue({ ...LEASE, meters: [{ ...LEASE.meters[0], pendingReading: 1250 }] });
    renderAt("/rentals/leases/l1");

    const meter = (await screen.findAllByTestId("meter-row"))[0];
    fireEvent.click(within(meter).getByRole("button", { name: "Read" }));
    const dialog = await screen.findByRole("dialog", { name: /Rryma/ });
    fireEvent.change(within(dialog).getByLabelText("Reading"), { target: { value: "1250" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.readLeaseMeter).toHaveBeenCalledWith("c1", "l1", "m1", { reading: 1250 }));
    // The pending reading is the API's.
    await waitFor(() => expect(within(screen.getAllByTestId("meter-row")[0]).getByText("1,250")).toBeInTheDocument());
  });
});
