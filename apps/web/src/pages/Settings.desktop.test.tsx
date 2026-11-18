import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { Settings } from "@/pages/Settings";

const access = vi.hoisted(() => ({ settings: true }));

const api = vi.hoisted(() => ({
  getDesktopLicense: vi.fn(),
  getMyAccount: vi.fn(),
}));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { ...actual.apiClient, ...api } };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ auth: { userId: "u1", email: "owner@firma.test", token: "t" } }),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: null, activeCompanyId: null }),
}));

vi.mock("@/hooks/useMyAccess", () => ({
  useMyAccess: () => ({ canSee: (module: string) => (module === "settings" ? access.settings : true) }),
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

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProviderWrapper>
        <ConfirmProvider>
          <MemoryRouter>
            <Settings />
          </MemoryRouter>
        </ConfirmProvider>
      </IntlProviderWrapper>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  bridge.listBackups.mockResolvedValue([]);
  bridge.getBackupSettings.mockResolvedValue({ dir: "/b", retentionDays: 30, lastBackupAt: null });
  api.getDesktopLicense.mockResolvedValue({ status: "Trial", trialDaysLeft: 10, machineCode: "ABCD-EFGH-IJKL-MNOP" });
  api.getMyAccount.mockResolvedValue({ isPlatformAdmin: true });
  (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = bridge;
});

afterEach(() => {
  delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
});

describe("Settings on desktop", () => {
  it("SettingsDesktop_WithoutSettingsAccess_OnlyBackupNowListAndStatus", async () => {
    access.settings = false;
    renderSettings();
    expect(await screen.findByText("/b")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back up now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore from file" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "Generate a new recovery code" })).not.toBeInTheDocument();
  });

  it("SettingsDesktop_WithSettingsAccess_ShowsRestoreFolderAndRecoveryCode", async () => {
    access.settings = true;
    renderSettings();
    expect(await screen.findByRole("button", { name: "Generate a new recovery code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore from file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });
});
