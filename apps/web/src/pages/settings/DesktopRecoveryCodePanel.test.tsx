import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import regenerateFixture from "@/mocks/desktop-recovery-code-regenerate.json";
import { DesktopRecoveryCodePanel } from "@/pages/settings/DesktopRecoveryCodePanel";

const api = vi.hoisted(() => ({
  regenerateDesktopRecoveryCode: vi.fn(),
  getMyAccount: vi.fn(),
}));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { ...actual.apiClient, ...api } };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { userId: "u1", email: "owner@firma.test", token: "t" } }),
}));

const bridge = {
  isDesktop: true,
  version: "1.0.0",
  backupNow: vi.fn(),
  listBackups: vi.fn(),
  restoreFromFile: vi.fn(),
  chooseBackupDir: vi.fn(),
  getBackupSettings: vi.fn(),
  openLogFolder: vi.fn(),
};

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProviderWrapper>
        <DesktopRecoveryCodePanel />
      </IntlProviderWrapper>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getMyAccount.mockResolvedValue({ isPlatformAdmin: true });
  (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = bridge;
});

afterEach(() => {
  delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
});

describe("DesktopRecoveryCodePanel", () => {
  it("RecoveryCodePanel_HiddenInBrowser", () => {
    delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
    expect(api.getMyAccount).not.toHaveBeenCalled();
  });

  it("RecoveryCodePanel_HiddenForANonAdministrator", async () => {
    api.getMyAccount.mockResolvedValue({ isPlatformAdmin: false });
    const { container } = renderPanel();
    await waitFor(() => expect(api.getMyAccount).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("RecoveryCodePanel_AsksForThePassword_ShowsTheNewCodeOnce", async () => {
    api.regenerateDesktopRecoveryCode.mockResolvedValue(regenerateFixture);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Generate a new recovery code" }));
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: "Secret123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(api.regenerateDesktopRecoveryCode).toHaveBeenCalledWith({ currentPassword: "Secret123!" }));
    expect(await screen.findByText(regenerateFixture.recoveryCode)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    const done = screen.getByRole("button", { name: "Continue" });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I saved/ }));
    fireEvent.click(done);

    expect(screen.queryByText(regenerateFixture.recoveryCode)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate a new recovery code" })).toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(regenerateFixture.recoveryCode);
  });

  it("RecoveryCodePanel_WrongPassword_ShowsTheServerMessage", async () => {
    api.regenerateDesktopRecoveryCode.mockRejectedValue(
      new ApiException("x", 400, JSON.stringify("The current password is not correct."), {}, null),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Generate a new recovery code" }));
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("The current password is not correct.")).toBeInTheDocument();
    expect(screen.queryByText(regenerateFixture.recoveryCode)).not.toBeInTheDocument();
  });
});
