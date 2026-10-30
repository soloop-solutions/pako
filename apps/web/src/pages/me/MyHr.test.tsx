import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CreateMyLeaveRequest, MyProfileResponse, UpdateMyProfileRequest } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { MyLeave } from "@/pages/me/MyLeave";
import { MyProfile } from "@/pages/me/MyProfile";

const companyId = "11111111-1111-1111-1111-111111111111";

let profile: MyProfileResponse = {
  employeeId: "e1",
  name: "Arta Krasniqi",
  personalNumber: "1234567890",
  email: "arta@x.test",
  phone: undefined,
  address: undefined,
  jobTitle: "Analyst",
  departmentName: "Finance",
  managerName: "Mira",
  hireDate: "2024-01-15",
  iban: "XK051212012345678906",
  bankName: "TEB",
  receivePayslipsByEmail: false,
  preferredLanguage: "en",
  pendingBankChange: undefined,
};

const updateMock = vi.fn(async (_companyId: string, body: UpdateMyProfileRequest) => {
  profile = {
    ...profile,
    phone: body.phone,
    pendingBankChange:
      body.iban && body.iban !== profile.iban
        ? {
            id: "c1",
            employeeId: "e1",
            employeeName: profile.name,
            newIban: body.iban,
            newBankName: body.bankName,
            previousIban: profile.iban,
            previousBankName: profile.bankName,
            state: "Pending",
            requestedAt: "2026-10-30T10:00:00Z",
            decidedAt: undefined,
          }
        : undefined,
  };
  return profile;
});

const createLeaveMock = vi.fn(async (_companyId: string, body: CreateMyLeaveRequest) => ({
  id: "r1",
  employeeId: "e1",
  employeeName: "Arta Krasniqi",
  leaveTypeId: body.leaveTypeId,
  leaveTypeName: "Annual leave",
  startDate: body.startDate,
  endDate: body.endDate,
  days: 3,
  reason: body.reason,
  state: "Pending",
  decidedAt: undefined,
  createdAt: "2026-10-30T10:00:00Z",
}));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getMyProfile: async () => profile,
      updateMyProfile: (id: string, body: UpdateMyProfileRequest) => updateMock(id, body),
      listMyLeaveTypes: async () => [
        { id: "t1", code: "AL", name: "Annual leave", defaultAnnualDays: 20, payPercent: 100, isActive: true },
      ],
      listMyLeaveBalances: async () => [
        {
          employeeId: "e1", employeeName: "Arta Krasniqi", leaveTypeId: "t1", leaveTypeName: "Annual leave", year: 2026,
          allocated: 22, taken: 5, pending: 0, remaining: 17, isOverride: false, carriedOver: 2, expiredCarryOver: 0,
          carryOverExpiresOn: "2026-06-30",
        },
      ],
      listMyLeaveRequests: async () => [],
      listMyTeamLeaveRequests: async () => [],
      createMyLeaveRequest: (id: string, body: CreateMyLeaveRequest) => createLeaveMock(id, body),
    },
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompanyId: companyId, activeCompany: { id: companyId, name: "Test Co" } }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isTeamManager: false, linkedEmployeeId: "e1" }, isLoading: false, isStaff: true, canSee: () => true, canWrite: () => false }),
}));

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>{page}</QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("My profile", () => {
  it("applies the phone at once but leaves a new IBAN pending HR approval", async () => {
    renderPage(<MyProfile />);
    const ibanInput = await screen.findByLabelText("IBAN");
    expect(ibanInput).toHaveValue("XK051212012345678906");

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+383 44 123 456" } });
    fireEvent.change(ibanInput, { target: { value: "XK27 1701 0000 0000 0012" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][1]).toMatchObject({ phone: "+383 44 123 456", iban: "XK271701000000000012" });
    expect(await screen.findByText("Saved. The new bank account is waiting for HR approval.")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for HR: change salary account to XK271701000000000012/)).toBeInTheDocument();
  });
});

describe("My leave", () => {
  it("shows balances with carried-over days and submits a request", async () => {
    renderPage(<MyLeave />);
    expect(await screen.findByText("17 days left")).toBeInTheDocument();
    expect(screen.getByText("Includes 2 carried over, usable until 2026-06-30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText("Choose a leave type and both dates.")).toBeInTheDocument();
    expect(createLeaveMock).not.toHaveBeenCalled();
  });
});
