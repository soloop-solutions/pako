import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyResponse } from "@pako/shared";

import { RequireCompany } from "@/components/RequireCompany";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { CompanySelect } from "@/pages/CompanySelect";

const companies = [
  { id: "c1", name: "Pako Demo Sh.p.k.", businessNumber: "811111111", municipality: "Prishtinë", isArchived: false },
  { id: "c2", name: "Dardania Market", businessNumber: "822222222", municipality: "Prizren", isArchived: false },
  { id: "c3", name: "Old Co", isArchived: true },
] as CompanyResponse[];

let account = { userId: "u1", email: "me@co.test", isPlatformAdmin: false, companyLimit: undefined as number | undefined, companiesCreated: 1 };

const company = {
  companies,
  activeCompanyId: null as string | null,
  activeCompany: null,
  loading: false,
  error: null,
  setActiveCompanyId: vi.fn(),
  leaveCompany: vi.fn(),
  companiesOpenElsewhere: vi.fn(async (): Promise<string[]> => []),
  replacedBy: null as { closedId: string; openedId: string } | null,
  clearReplacedNotice: vi.fn(),
  createCompany: vi.fn(async (name: string) => ({ company: { id: "new", name, isArchived: false } as CompanyResponse, profileError: null })),
  refresh: vi.fn(),
};

vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggle: vi.fn() }) }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => company }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ auth: { userId: "u1", email: "me@co.test" }, logout: vi.fn() }) }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      firmsAll: async () => [],
      getMyAccount: async () => account,
    },
  };
});

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[url]}>
        <IntlProviderWrapper>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/select-company" element={<CompanySelect />} />
              <Route element={<RequireCompany />}>
                <Route path="/dashboard" element={<p>Inside the company</p>} />
              </Route>
            </Routes>
          </QueryClientProvider>
        </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("Company lobby", () => {
  beforeEach(() => {
    company.activeCompanyId = null;
    company.replacedBy = null;
    account = { userId: "u1", email: "me@co.test", isPlatformAdmin: false, companyLimit: undefined, companiesCreated: 1 };
    vi.clearAllMocks();
    company.companiesOpenElsewhere.mockResolvedValue([]);
    localStorage.clear();
  });

  it("the app sends a user with no active company to the lobby, even with a single company", async () => {
    renderAt("/dashboard");
    expect(await screen.findByRole("heading", { name: "Choose a company" })).toBeInTheDocument();
    expect(screen.queryByText("Inside the company")).not.toBeInTheDocument();
  });

  it("arriving in the lobby leaves the current company", () => {
    company.activeCompanyId = "c1";
    renderAt("/select-company");
    expect(company.leaveCompany).toHaveBeenCalled();
  });

  it("searches, switches to the list view, and opens the chosen company", async () => {
    renderAt("/select-company");
    expect(screen.getByText("Pako Demo Sh.p.k.")).toBeInTheDocument();
    expect(screen.queryByText("Old Co")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Search by name/), { target: { value: "prizren" } });
    expect(screen.queryByText("Pako Demo Sh.p.k.")).not.toBeInTheDocument();
    expect(screen.getByText("Dardania Market")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(localStorage.getItem("pako.lobby.view")).toBe("list");

    fireEvent.click(screen.getByText("Dardania Market"));
    await waitFor(() => expect(company.setActiveCompanyId).toHaveBeenCalledWith("c2"));
  });

  it("creates a new company with the same details as Settings, and opens it", async () => {
    renderAt("/select-company");
    await waitFor(() => expect(screen.getByRole("button", { name: "New company" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "New company" }));
    // Every section of Settings → Company profile is in the dialog.
    const dialog = await screen.findByRole("dialog");
    for (const label of ["Trading name", "Business number (NRB)", "Fiscal number (NF)", "VAT number (TVSH)", "Municipality / City", "IBAN", "Document footer"]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    fireEvent.change(within(dialog).getByLabelText("Company name *"), { target: { value: "Fresh Co" } });
    fireEvent.change(within(dialog).getByLabelText("Business number (NRB)"), { target: { value: "810000001" } });
    fireEvent.change(within(dialog).getByLabelText("Municipality / City"), { target: { value: "Pejë" } });
    fireEvent.change(within(dialog).getByLabelText("IBAN"), { target: { value: "XK051212012345678906" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and open" }));

    await waitFor(() => expect(company.createCompany).toHaveBeenCalled());
    const [name, firmId, options] = company.createCompany.mock.calls[0] as unknown as [string, string | undefined, { isVatRegistered: boolean; profile: Record<string, unknown> }];
    expect(name).toBe("Fresh Co");
    expect(firmId).toBeUndefined();
    expect(options.isVatRegistered).toBe(true);
    expect(options.profile).toMatchObject({ name: "Fresh Co", businessNumber: "810000001", municipality: "Pejë", iban: "XK051212012345678906", country: "Kosovo" });
    expect(options.profile.tradingName).toBeUndefined();
    await waitFor(() => expect(company.setActiveCompanyId).toHaveBeenCalledWith("new"));
  });

  it("allows only one company at a time: opening another asks first, since it closes the one open elsewhere", async () => {
    company.companiesOpenElsewhere.mockResolvedValue(["c1"]);
    renderAt("/select-company");
    fireEvent.click(screen.getByText("Dardania Market"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Pako Demo Sh.p.k. is open in another tab or window. Opening Dardania Market here will close Pako Demo Sh.p.k. there.");
    expect(company.setActiveCompanyId).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open Dardania Market" }));
    expect(company.setActiveCompanyId).toHaveBeenCalledWith("c2");
  });

  it("the same company open elsewhere is fine", async () => {
    company.companiesOpenElsewhere.mockResolvedValue(["c2"]);
    renderAt("/select-company");
    fireEvent.click(screen.getByText("Dardania Market"));
    await waitFor(() => expect(company.setActiveCompanyId).toHaveBeenCalledWith("c2"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains why a company was closed in this tab", () => {
    company.replacedBy = { closedId: "c1", openedId: "c2" };
    renderAt("/select-company");
    expect(screen.getByText(/Pako Demo Sh.p.k. was closed here because Dardania Market was opened in another tab or window/)).toBeInTheDocument();
  });

  it("stops new companies at the account's limit, and shows administrators the way to the panel", async () => {
    account = { userId: "u1", email: "me@co.test", isPlatformAdmin: false, companyLimit: 1, companiesCreated: 1 };
    renderAt("/select-company");
    expect(await screen.findByText(/Company limit reached \(1 of 1\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New company" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("platform administrators see the Administration button", async () => {
    account = { userId: "u1", email: "me@co.test", isPlatformAdmin: true, companyLimit: undefined, companiesCreated: 4 };
    renderAt("/select-company");
    expect(await screen.findByRole("button", { name: "Administration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New company" })).toBeEnabled();
  });

  it("after a reload, waits for the company list instead of sending the user away or showing a page with no company", () => {
    company.activeCompanyId = "c1";
    (company as { loaded?: boolean }).loaded = false;
    renderAt("/dashboard");
    expect(screen.queryByText("Inside the company")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose a company" })).not.toBeInTheDocument();
    (company as { loaded?: boolean }).loaded = true;
  });
});
