import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { PlatformAdmin } from "@/pages/platform/PlatformAdmin";

let isAdmin = true;
const approve = vi.fn(async () => ({ request: {}, userId: "new", setPasswordUrl: "https://app.test/reset-password?email=a&token=t" }));
const updateModules = vi.fn(async () => ({}));
const updateFeatures = vi.fn(async () => ({}));

const request = {
  id: "r1", fullName: "Ardita Krasniqi", email: "ardita@firm.test", phone: "+383 44", firmName: "Krasniqi Acc", city: "Prishtinë",
  requestedCompanies: 3, message: "Five clients", status: "Pending", createdAt: "2026-10-29T09:00:00Z",
};
const company = {
  id: "c1", name: "Pako Demo Sh.p.k.", createdByEmail: "demo.admin@pako.test", modules: ["sales", "purchases", "accounting", "reports", "hr", "payroll"],
  isArchived: false, createdAt: "2026-01-01T00:00:00Z", users: 2, postedInvoices: 220, postedBills: 185, employees: 14,
  businessType: 1, features: ["grocery", "onlineSales"],
};

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getMyAccount: async () => ({ userId: "u1", email: "root@pako.test", isPlatformAdmin: isAdmin, companiesCreated: 0 }),
      getPlatformOverview: async () => ({
        users: 5, accountantCount: 2, platformAdmins: 1, disabledUsers: 0, companies: 3, pendingRequests: 1, invoicesLast30Days: 20, activeUsersLast30Days: 3,
        accountants: [
          { userId: "a1", email: "demo.admin@pako.test", isDisabled: false, isPlatformAdmin: false, companyLimit: 3, companiesCreated: 1, teamMembers: 1,
            postedInvoices: 220, invoicesLast30Days: 20, postedBills: 185, employees: 14, payrollRuns: 21 },
        ],
      }),
      listAccountRequests: async () => ({ items: [request], total: 1, page: 1, pageSize: 50 }),
      countPendingAccountRequests: async () => 1,
      listPlatformAudit: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
      approveAccountRequest: (...args: unknown[]) => approve(...(args as [])),
      listPlatformCompanies: async () => ({ items: [company], total: 1, page: 1, pageSize: 50 }),
      updateCompanyModules: (...args: unknown[]) => updateModules(...(args as [])),
      updateCompanyFeatures: (...args: unknown[]) => updateFeatures(...(args as [])),
      listPlatformUsers: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
    },
  };
});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ auth: { userId: "u1", email: "root@pako.test" }, logout: vi.fn() }) }));
vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggle: vi.fn() }) }));

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/platform" element={<PlatformAdmin />} />
            <Route path="/select-company" element={<p>Company list</p>} />
          </Routes>
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Administration panel", () => {
  beforeEach(() => {
    isAdmin = true;
    vi.clearAllMocks();
  });

  it("is only for platform administrators", async () => {
    isAdmin = false;
    renderAt("/platform");
    expect(await screen.findByText("Company list")).toBeInTheDocument();
  });

  it("shows usage per accountant with their companies against their limit", async () => {
    renderAt("/platform");
    expect(await screen.findByText("Usage by accountant")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Account requests\s*1/ })).toBeInTheDocument();
  });

  it("approves a request with a company limit and shows the set-password link", async () => {
    renderAt("/platform?tab=requests");
    fireEvent.click(await screen.findByText("Ardita Krasniqi"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Five clients")).toBeInTheDocument();
    const limit = within(dialog).getByLabelText("Companies they may create");
    expect(limit).toHaveValue(3);
    fireEvent.change(limit, { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve and create account" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("r1", { companyLimit: 2, note: undefined }));
    expect(await within(dialog).findByDisplayValue("https://app.test/reset-password?email=a&token=t")).toBeInTheDocument();
  });

  it("switches modules off per company; turning HR off takes payroll with it", async () => {
    renderAt("/platform?tab=companies");
    fireEvent.click(await screen.findByText("Pako Demo Sh.p.k."));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /^HR/ }));
    expect(within(dialog).getByRole("checkbox", { name: /^Payroll/ })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateModules).toHaveBeenCalledWith("c1", { modules: ["sales", "purchases", "accounting", "reports"] }));
    // The packs were not touched, so they are not saved.
    expect(updateFeatures).not.toHaveBeenCalled();
  });

  // Business types: each company's type and packs, the packs switched on and off like modules.
  it("shows the business type and saves the company's packs", async () => {
    renderAt("/platform?tab=companies");
    expect(await screen.findByText("Market / shop")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Pako Demo Sh.p.k."));
    const dialog = await screen.findByRole("dialog");
    const packs = within(dialog).getByTestId("platform-packs");
    expect(within(packs).getByRole("checkbox", { name: /^Grocery/ })).toBeChecked();
    expect(within(packs).getByRole("checkbox", { name: /^Hotel/ })).not.toBeChecked();
    fireEvent.click(within(packs).getByRole("checkbox", { name: /^Online sales/ }));
    fireEvent.click(within(packs).getByRole("checkbox", { name: /^Distribution/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateFeatures).toHaveBeenCalledWith("c1", { features: ["grocery", "distribution"] }));
    expect(updateModules).not.toHaveBeenCalled();
  });

  it("moves between tabs with the arrow keys and records every change under Activity", async () => {
    renderAt("/platform");
    const overview = await screen.findByRole("tab", { name: "Overview" });
    expect(overview).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Users" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(overview, { key: "End" });
    expect(await screen.findByRole("tab", { name: "Activity", selected: true })).toBeInTheDocument();
    expect(await screen.findByText("No administration changes yet.")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "platform-tab-activity");
  });
});
