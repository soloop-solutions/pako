import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "@pako/shared";

import { App } from "@/App";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

const api = vi.hoisted(() => ({
  getDesktopSetup: vi.fn(),
  getDesktopLicense: vi.fn(),
}));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { ...actual.apiClient, ...api } };
});

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getDesktopSetup.mockRejectedValue(new ApiException("nf", 404, "", {}, null));
  api.getDesktopLicense.mockRejectedValue(new ApiException("nf", 404, "", {}, null));
  window.history.pushState({}, "", "/login");
});

afterEach(() => {
  delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
});

describe("Hosted build", () => {
  it("Hosted_NoDesktopUi_WhenEndpointsAbsent", async () => {
    (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = {
      isDesktop: true,
      version: "1",
      backupNow: () => undefined,
      listBackups: () => undefined,
      restoreFromFile: () => undefined,
      chooseBackupDir: () => undefined,
      getBackupSettings: () => undefined,
      openLogFolder: () => undefined,
    };
    render(
      <IntlProviderWrapper>
        <App />
      </IntlProviderWrapper>,
    );
    await waitFor(() => expect(api.getDesktopSetup).toHaveBeenCalled());
    expect(await screen.findByText("Log in to PAKO")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(screen.queryByText(/recovery code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("License key")).not.toBeInTheDocument();
  });

  it("Hosted_NoDesktopRequests_WithoutBridge", async () => {
    render(
      <IntlProviderWrapper>
        <App />
      </IntlProviderWrapper>,
    );
    expect(await screen.findByText("Log in to PAKO")).toBeInTheDocument();
    expect(api.getDesktopSetup).not.toHaveBeenCalled();
    expect(screen.queryByText(/recovery code/i)).not.toBeInTheDocument();
  });
});
