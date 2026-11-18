import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "@pako/shared";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { FirstRunPage } from "@/pages/desktop/FirstRunPage";
import { LicenseBanner } from "@/pages/desktop/LicenseBanner";
import { RecoverAdminPage } from "@/pages/desktop/RecoverAdminPage";
import licenseFixture from "@/mocks/desktop-license.json";
import setupFixture from "@/mocks/desktop-setup.json";
import setupStatusFixture from "@/mocks/desktop-setup-status.json";

const api = vi.hoisted(() => ({
  getDesktopSetup: vi.fn(),
  completeDesktopSetup: vi.fn(),
  recoverDesktopAdmin: vi.fn(),
  getDesktopLicense: vi.fn(),
  activateDesktopLicense: vi.fn(),
}));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { ...actual.apiClient, ...api } };
});

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

function wrap(ui: React.ReactNode, initial = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProviderWrapper>
        <MemoryRouter initialEntries={[initial]}>{ui}</MemoryRouter>
      </IntlProviderWrapper>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = bridge;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
});

async function fillFirstRun() {
  fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: "admin@firma.test" } });
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Arta Krasniqi" } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "Secret123!" } });
  fireEvent.click(screen.getByRole("button", { name: /Create administrator/ }));
}

describe("FirstRunPage", () => {
  beforeEach(() => {
    api.getDesktopSetup.mockResolvedValue(setupStatusFixture);
    api.completeDesktopSetup.mockResolvedValue(setupFixture);
  });

  function renderFirstRun() {
    return wrap(
      <Routes>
        <Route path="/first-run" element={<FirstRunPage />} />
        <Route path="/login" element={<div>login screen</div>} />
      </Routes>,
      "/first-run",
    );
  }

  it("FirstRun_ShowsCodeFromResponse", async () => {
    renderFirstRun();
    await fillFirstRun();
    expect(await screen.findByText(setupFixture.recoveryCode)).toBeInTheDocument();
    expect(api.completeDesktopSetup).toHaveBeenCalledWith({
      email: "admin@firma.test",
      fullName: "Arta Krasniqi",
      password: "Secret123!",
    });
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage })).not.toContain(setupFixture.recoveryCode);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(setupFixture.recoveryCode);
  });

  it("FirstRun_ContinueDisabled_UntilSavedTicked", async () => {
    renderFirstRun();
    await fillFirstRun();
    await screen.findByText(setupFixture.recoveryCode);
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I saved/ }));
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(await screen.findByText("login screen")).toBeInTheDocument();
  });
});

describe("RecoverAdminPage", () => {
  it("Recover_SubmitsCodeAndNewPassword", async () => {
    api.recoverDesktopAdmin.mockResolvedValue(undefined);
    wrap(
      <Routes>
        <Route path="/recover-admin" element={<RecoverAdminPage />} />
        <Route path="/login" element={<div>login screen</div>} />
      </Routes>,
      "/recover-admin",
    );
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "admin@firma.test" } });
    fireEvent.change(screen.getByLabelText(/Recovery code/), { target: { value: setupFixture.recoveryCode } });
    fireEvent.change(screen.getByLabelText(/New password/), { target: { value: "Fresh456!" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() =>
      expect(api.recoverDesktopAdmin).toHaveBeenCalledWith({
        email: "admin@firma.test",
        recoveryCode: setupFixture.recoveryCode,
        newPassword: "Fresh456!",
      }),
    );
    expect(await screen.findByText("login screen")).toBeInTheDocument();
  });

  it("Recover_ShowsGenericErrorOn400", async () => {
    api.recoverDesktopAdmin.mockRejectedValue(new ApiException("x", 400, JSON.stringify("Recovery code is not valid."), {}, null));
    wrap(<RecoverAdminPage />);
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "nobody@firma.test" } });
    fireEvent.change(screen.getByLabelText(/Recovery code/), { target: { value: "AAAA" } });
    fireEvent.change(screen.getByLabelText(/New password/), { target: { value: "Fresh456!" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText(/could not be verified/i)).toBeInTheDocument();
  });
});

describe("LicenseBanner", () => {
  it("LicenseBanner_ShowsReadOnlyAndMachineCode", async () => {
    api.getDesktopLicense.mockResolvedValue({ ...licenseFixture, status: "ReadOnly", trialDaysLeft: 0 });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    wrap(<LicenseBanner />);
    expect(await screen.findByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText(licenseFixture.machineCode)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(licenseFixture.machineCode);
  });

  it("LicenseBanner_ShowsTrialDaysLeft", async () => {
    api.getDesktopLicense.mockResolvedValue(licenseFixture);
    wrap(<LicenseBanner />);
    expect(await screen.findByText(/9 days left/)).toBeInTheDocument();
  });

  it("LicenseBanner_ActivatesKey", async () => {
    api.getDesktopLicense.mockResolvedValue({ ...licenseFixture, status: "ReadOnly", trialDaysLeft: 0 });
    api.activateDesktopLicense.mockResolvedValue({ ...licenseFixture, status: "Licensed", customer: "Firma Sh.p.k." });
    wrap(<LicenseBanner />);
    fireEvent.change(await screen.findByLabelText("License key"), { target: { value: "PAKO-KEY-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(api.activateDesktopLicense).toHaveBeenCalledWith({ licenseKey: "PAKO-KEY-123" }));
    await waitFor(() => expect(screen.queryByLabelText("License key")).not.toBeInTheDocument());
  });

  it("LicenseBanner_ShowsServerMessageOnBadKey", async () => {
    api.getDesktopLicense.mockResolvedValue(licenseFixture);
    api.activateDesktopLicense.mockRejectedValue(new ApiException("x", 400, JSON.stringify("That license key is not valid."), {}, null));
    wrap(<LicenseBanner />);
    fireEvent.change(await screen.findByLabelText("License key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(await screen.findByText("That license key is not valid.")).toBeInTheDocument();
  });
});
