import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "@pako/shared";

import { createAppQueryClient } from "@/api/queryClient";
import { LICENSE_KEY, useDesktopLicense } from "@/pages/desktop/useDesktopLicense";
import licenseFixture from "@/mocks/desktop-license.json";

const api = vi.hoisted(() => ({ getDesktopLicense: vi.fn() }));

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

function setup() {
  const queryClient = createAppQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useDesktopLicense(), { wrapper });
  return { queryClient, ...hook };
}

beforeEach(() => {
  api.getDesktopLicense.mockReset();
  api.getDesktopLicense.mockResolvedValue(licenseFixture);
  (window as unknown as { pakoDesktop?: unknown }).pakoDesktop = bridge;
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { pakoDesktop?: unknown }).pakoDesktop;
});

describe("license state refresh", () => {
  it("LicenseState_RefetchesOnAnInterval", async () => {
    vi.useFakeTimers();
    setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getDesktopLicense).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.getDesktopLicense.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("LicenseState_RefetchesWhenTheWindowRegainsFocus", async () => {
    vi.useFakeTimers();
    setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getDesktopLicense).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getDesktopLicense.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("LicenseState_RefetchesAfterALicenseReadOnlyRefusal", async () => {
    vi.useFakeTimers();
    const { queryClient } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getDesktopLicense).toHaveBeenCalledTimes(1);
    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: async () => {
          throw new ApiException("x", 403, JSON.stringify({ code: "LicenseReadOnly" }), {}, null);
        },
      })
      .execute(undefined)
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getDesktopLicense).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(LICENSE_KEY)).toBeDefined();
  });

  it("LicenseState_IgnoresOtherRefusals", async () => {
    vi.useFakeTimers();
    const { queryClient } = setup();
    await vi.advanceTimersByTimeAsync(0);
    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: async () => {
          throw new ApiException("x", 403, JSON.stringify({ code: "Forbidden" }), {}, null);
        },
      })
      .execute(undefined)
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getDesktopLicense).toHaveBeenCalledTimes(1);
  });
});
