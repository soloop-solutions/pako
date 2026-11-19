import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.each([
  ["the desktop sentinel /", "/"],
  ["an empty VITE_API_BASE_URL", ""],
])("same-origin base from %s", (_label, base) => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", base);
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

describe("hosted base url", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps an absolute base unchanged", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.pako.example");
    const { API_BASE_URL } = await import("./client");
    expect(API_BASE_URL).toBe("https://api.pako.example");
  });

  it("falls back to the local API when the variable is not set", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    const { API_BASE_URL } = await import("./client");
    expect(import.meta.env.VITE_API_BASE_URL).toBeUndefined();
    expect(API_BASE_URL).toBe("http://127.0.0.1:5248");
  });
});
