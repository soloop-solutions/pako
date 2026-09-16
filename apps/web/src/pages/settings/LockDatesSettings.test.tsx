import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AccountLockExceptionResponse, CompanyResponse } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { SOFT_LOCK_DATE_KEYS } from "@/lib/lock-dates";
import { LockDatesSettings } from "@/pages/settings/LockDatesSettings";

// F3's real screen now talks to the real backend contract (backend/Pako.Api/Controllers/
// CompanyLocksController.cs, route api/companies/{companyId}/locks) via the generated
// apiClient.soft/hard/exceptionsAll/exceptions/revoke — mocked here directly (same pattern as
// Partners.test.tsx/ChartOfAccounts.test.tsx use for their own real endpoints) rather than via
// MSW, since there is no longer a provisional mock behind this screen. `currentCompany` stands in
// for CompanyContext's `companies` list — apiClient.soft/hard mutate it in place, the same way the
// real backend mutates the row PUT soft/hard writes to, so a re-render after a save picks up the
// new lock dates without a real network refetch.

const companyId = "11111111-1111-1111-1111-111111111111";

const initialCompany: CompanyResponse = {
  id: companyId,
  name: "Test Co",
  firmId: undefined,
  accountingLockDate: undefined,
  taxLockDate: undefined,
  saleLockDate: undefined,
  purchaseLockDate: undefined,
  hardLockDate: undefined,
  enabledProfiles: 1,
  isVatRegistered: true,
  allowNumberOverride: false,
};

// `backendCompany` is what apiClient.soft/hard mutate directly, mirroring the real
// CompanyLocksController writing straight to the row. `contextCompany` is what the mocked
// useCompany() actually returns to the component — it only picks up backendCompany's changes when
// `refresh()` is called, exactly like the real CompanyContext (whose `companies` state only
// changes inside its own `refresh`, via a real GET /api/companies). Two vars, not one, so a save
// that PUTs several soft-lock fields one at a time doesn't make the component's `company` prop
// flicker mid-save the way a single shared mutable object would — that flicker cannot happen
// against the real backend, where nothing re-renders LockDatesSettings until this screen's own
// `refreshCompanies()` call resolves.
let backendCompany: CompanyResponse = { ...initialCompany };
let contextCompany: CompanyResponse = { ...initialCompany };

let exceptions: AccountLockExceptionResponse[] = [];
let nextExceptionId = 1;

const membersAll = vi.fn(async (companyId: string) => {
  void companyId;
  return [
    { membershipId: "m1", userId: "admin-user", email: "admin@pako.test", role: 2 },
    { membershipId: "m2", userId: "viewer-user", email: "viewer@pako.test", role: 3 },
  ];
});

const softMock = vi.fn(async (_companyId: string, body: { lockDateField: number; lockDate?: string }) => {
  const key = SOFT_LOCK_DATE_KEYS[body.lockDateField];
  backendCompany = { ...backendCompany, [key]: body.lockDate };
  return backendCompany;
});

const hardMock = vi.fn(async (_companyId: string, body: { lockDate: string }) => {
  backendCompany = { ...backendCompany, hardLockDate: body.lockDate };
  return backendCompany;
});

const exceptionsAllMock = vi.fn(async (companyId: string) => {
  void companyId;
  return exceptions;
});

const grantMock = vi.fn(
  async (
    _companyId: string,
    body: { userId: string; lockDateField: number; lockDate: string; reason: string; endsAt: string },
  ) => {
    const created: AccountLockExceptionResponse = {
      id: String(nextExceptionId++),
      userId: body.userId,
      lockDateField: body.lockDateField,
      lockDate: body.lockDate,
      reason: body.reason,
      endsAt: body.endsAt,
      createdAt: new Date().toISOString(),
      grantedByUserId: "admin-user",
      revokedAt: undefined,
      revokedByUserId: undefined,
      isLive: true,
    };
    exceptions = [...exceptions, created];
    return created;
  },
);

const revokeMock = vi.fn(async (_companyId: string, exceptionId: string) => {
  exceptions = exceptions.map((e) =>
    e.id === exceptionId ? { ...e, revokedAt: new Date().toISOString(), revokedByUserId: "admin-user", isLive: false } : e,
  );
  return exceptions.find((e) => e.id === exceptionId)!;
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      membersAll: (companyId: string) => membersAll(companyId),
      soft: (companyId: string, body: { lockDateField: number; lockDate?: string }) => softMock(companyId, body),
      hard: (companyId: string, body: { lockDate: string }) => hardMock(companyId, body),
      exceptionsAll: (companyId: string) => exceptionsAllMock(companyId),
      exceptions: (
        companyId: string,
        body: { userId: string; lockDateField: number; lockDate: string; reason: string; endsAt: string },
      ) => grantMock(companyId, body),
      revoke: (companyId: string, exceptionId: string) => revokeMock(companyId, exceptionId),
    },
  };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { token: "t", userId: "admin-user", email: "admin@pako.test" } }),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [contextCompany],
    activeCompanyId: contextCompany.id,
    activeCompany: contextCompany,
    loading: false,
    error: null,
    setActiveCompanyId: vi.fn(),
    createCompany: vi.fn(),
    refresh: vi.fn(async () => {
      contextCompany = { ...backendCompany };
    }),
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <IntlProviderWrapper>
      <QueryClientProvider client={queryClient}>
        <LockDatesSettings companyId={companyId} />
      </QueryClientProvider>
    </IntlProviderWrapper>,
  );
}

describe("LockDatesSettings", () => {
  it("loads all five lock dates unset and saves the four soft locks", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Global lock")).toBeInTheDocument());
    expect(screen.getByLabelText("Global lock")).toHaveValue("");
    expect(screen.getByLabelText("Tax lock")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Global lock"), { target: { value: "2026-08-31" } });
    fireEvent.change(screen.getByLabelText("Sale lock"), { target: { value: "2026-08-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByLabelText("Global lock")).toHaveValue("2026-08-31"));
    expect(screen.getByLabelText("Sale lock")).toHaveValue("2026-08-31");
    expect(softMock).toHaveBeenCalledTimes(2);
    expect(softMock).toHaveBeenCalledWith(companyId, { lockDateField: 0, lockDate: "2026-08-31" });
    expect(softMock).toHaveBeenCalledWith(companyId, { lockDateField: 2, lockDate: "2026-08-31" });
  });

  it("requires explicit confirmation before setting the hard lock, and it cannot be undone afterwards", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Hard lock")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Hard lock"), { target: { value: "2026-07-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Set hard lock" }));

    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, set the hard lock permanently" }));

    await waitFor(() => expect(screen.getByText("The hard lock is set to 2026-07-31.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Hard lock")).not.toBeInTheDocument();
    expect(hardMock).toHaveBeenCalledWith(companyId, { lockDate: "2026-07-31" });
  });

  it("grants and revokes a lock exception for an admin", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Member")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Member"), { target: { value: "viewer-user" } });
    fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Late supplier invoice" } });
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant exception" }));

    await waitFor(() => expect(screen.getByText("Late supplier invoice")).toBeInTheDocument());
    const row = screen.getByText("Late supplier invoice").closest("tr");
    if (!row) throw new Error("No row found for the granted exception");
    expect(within(row).getByText("viewer@pako.test")).toBeInTheDocument();
    expect(within(row).getByText("admin@pako.test")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(within(row).getByText("Revoked")).toBeInTheDocument());
    // Revoking marks the exception revoked but never removes it from the list — the backend
    // keeps the row for audit history (RevokedAt set, not deleted).
    expect(screen.getByText("Late supplier invoice")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });
});
