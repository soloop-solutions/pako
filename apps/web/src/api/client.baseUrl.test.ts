import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("empty VITE_API_BASE_URL (desktop build)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps the empty string and produces same-origin urls", async () => {
    const { API_BASE_URL, apiClient } = await import("./client");
    expect(API_BASE_URL).toBe("");
    await apiClient.getDesktopSetup();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/desktop/setup");
  });

  it("builds the hub url without a host", async () => {
    const { posHubUrl } = await import("@/lib/pos-hub");
    expect(posHubUrl()).toBe("/hubs/pos");
  });

  it("explains a LicenseReadOnly 403 instead of the generic permission message", async () => {
    const { getApiErrorMessage } = await import("./client");
    const { ApiException } = await import("@pako/shared");
    const body = JSON.stringify({ status: 403, title: "x", code: "LicenseReadOnly" });
    expect(getApiErrorMessage(new ApiException("m", 403, body, {}, null))).toMatch(/read-only/i);
    expect(getApiErrorMessage(new ApiException("m", 403, "{}", {}, null))).toMatch(/permission/i);
  });

  it("shows an absolute channel base url when the base is empty", async () => {
    const { publicApiBase } = await import("./client");
    expect(publicApiBase()).toBe(window.location.origin);
  });

  it("builds company image urls without a host", async () => {
    const { uploadUrl } = await import("./client");
    expect(uploadUrl("/uploads/companies/c1/logo.png")).toBe("/uploads/companies/c1/logo.png");
  });
});
