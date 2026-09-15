import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { LockDatesSettings } from "@/pages/settings/LockDatesSettings";

// F3's real screen is exercised against the PROVISIONAL mock (src/mocks/lockDatesHandlers.ts) via
// src/test/setup.ts's msw/node server — this proves the plumbing (read/save the four soft locks,
// hard-lock confirmation, grant/revoke an exception) works end to end against that mock, the same
// contract the dev server uses. `apiClient.membersAll` is the real generated client method (a real
// endpoint already exists), mocked here directly rather than via MSW so the test doesn't depend on
// a running backend.
const membersAll = vi.fn(async (companyId: string) => {
  void companyId;
  return [
    { membershipId: "m1", userId: "admin-user", email: "admin@pako.test", role: 2 },
    { membershipId: "m2", userId: "viewer-user", email: "viewer@pako.test", role: 3 },
  ];
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: { ...actual.apiClient, membersAll: (companyId: string) => membersAll(companyId) },
  };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { token: "t", userId: "admin-user", email: "admin@pako.test" } }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <IntlProviderWrapper>
      <QueryClientProvider client={queryClient}>
        <LockDatesSettings companyId="11111111-1111-1111-1111-111111111111" />
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
  });

  it("grants and revokes a lock exception for an admin", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Member")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Member"), { target: { value: "viewer-user" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Late supplier invoice" } });
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant exception" }));

    await waitFor(() => expect(screen.getByText("Late supplier invoice")).toBeInTheDocument());
    const row = screen.getByText("Late supplier invoice").closest("tr");
    if (!row) throw new Error("No row found for the granted exception");
    expect(within(row).getByText("viewer@pako.test")).toBeInTheDocument();
    expect(within(row).getByText("admin@pako.test")).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByText("Late supplier invoice")).not.toBeInTheDocument());
  });
});
