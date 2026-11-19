import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { NotificationSettingResponse, SaveNotificationSettingsRequest, TestEmailResponse } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { NotificationSettings } from "@/pages/settings/NotificationSettings";

const companyId = "11111111-1111-1111-1111-111111111111";

let settings: NotificationSettingResponse[] = [
  { template: "LeaveSubmitted", enabled: true },
  { template: "PayslipReady", enabled: true },
];

const saveMock = vi.fn(async (_companyId: string, body: SaveNotificationSettingsRequest) => {
  settings = body.settings;
  return settings;
});

const testMock = vi.fn<(companyId: string) => Promise<TestEmailResponse>>(async () => ({ recipient: "owner@co.test", sent: true, mode: "Api", error: undefined }));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getNotificationSettings: async () => settings,
      saveNotificationSettings: (id: string, body: SaveNotificationSettingsRequest) => saveMock(id, body),
      listNotificationLog: async () => ({
        items: [
          {
            id: "n1",
            template: "PayslipReady",
            recipientEmail: "arta@x.test",
            state: "Failed",
            attempts: 6,
            lastError: "SMTP down",
            createdAt: "2026-10-30T08:00:00Z",
            sentAt: undefined,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 200,
      }),
      retryNotification: vi.fn(async () => undefined),
      sendCompanyTestEmail: (id: string) => testMock(id),
    },
  };
});

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ access: { isAdmin: true }, isLoading: false, isStaff: false, canSee: () => true, canWrite: () => true }),
}));

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <IntlProviderWrapper>
        <QueryClientProvider client={queryClient}>
          <NotificationSettings companyId={companyId} />
        </QueryClientProvider>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

describe("NotificationSettings", () => {
  it("switches a template off and shows failed deliveries with a retry", async () => {
    renderCard();
    const payslip = await screen.findByLabelText("Payslip ready, PDF attached (to the employee)");
    expect(payslip).toBeChecked();

    fireEvent.click(payslip);

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith(companyId, {
        settings: [
          { template: "LeaveSubmitted", enabled: true },
          { template: "PayslipReady", enabled: false },
        ],
      }),
    );
    expect(await screen.findByText("arta@x.test")).toBeInTheDocument();
    expect(screen.getByText("SMTP down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("sends a test email and says what happened", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Send test email" }));
    expect(await screen.findByTestId("notifications-test-result")).toHaveTextContent("Test email sent to owner@co.test.");
    expect(testMock).toHaveBeenCalledWith(companyId);

    testMock.mockResolvedValueOnce({ recipient: "owner@co.test", sent: false, mode: "Api", error: "Email API answered 401: bad key" });
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await waitFor(() =>
      expect(screen.getByTestId("notifications-test-result")).toHaveTextContent("was not sent: Email API answered 401: bad key"),
    );

    testMock.mockResolvedValueOnce({ recipient: "owner@co.test", sent: true, mode: "Log", error: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
    await waitFor(() => expect(screen.getByTestId("notifications-test-result")).toHaveTextContent("log-only mode"));
  });
});
