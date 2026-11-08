import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getStoredAuth, setStoredAuth } from "@/lib/auth-storage";

import { apiClient } from "./client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("authorizedFetch refresh", () => {
  const fetchMock = vi.fn();
  const expired = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    fetchMock.mockReset();
    expired.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.addEventListener("pako:auth-expired", expired);
    setStoredAuth({ token: "old", userId: "u1", email: "a@b.c", refreshToken: "r1" });
  });

  afterEach(() => {
    window.removeEventListener("pako:auth-expired", expired);
    vi.unstubAllGlobals();
  });

  function route(handler: (url: string, auth: string | null) => Response | Promise<Response>) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(handler(String(url), new Headers(init?.headers).get("Authorization"))),
    );
  }

  it("refreshes on 401 and retries the request with the new token", async () => {
    route((url, auth) => {
      if (url.endsWith("/api/auth/refresh")) return json({ token: "new", userId: "u1", email: "a@b.c", refreshToken: "r2" });
      return auth === "Bearer new" ? json([]) : new Response(null, { status: 401 });
    });

    await apiClient.trialBalance("c1", undefined, undefined);

    expect(getStoredAuth()).toMatchObject({ token: "new", refreshToken: "r2" });
    expect(expired).not.toHaveBeenCalled();
  });

  it("sends one refresh for concurrent 401s", async () => {
    route((url, auth) => {
      if (url.endsWith("/api/auth/refresh")) return json({ token: "new", userId: "u1", email: "a@b.c", refreshToken: "r2" });
      return auth === "Bearer new" ? json([]) : new Response(null, { status: 401 });
    });

    await Promise.all([
      apiClient.trialBalance("c1", undefined, undefined),
      apiClient.trialBalance("c2", undefined, undefined),
      apiClient.trialBalance("c3", undefined, undefined),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("signs the user out only when the refresh itself is refused", async () => {
    route((url) => (url.endsWith("/api/auth/refresh") ? new Response(null, { status: 401 }) : new Response(null, { status: 401 })));

    await expect(apiClient.trialBalance("c1", undefined, undefined)).rejects.toBeDefined();

    expect(expired).toHaveBeenCalled();
  });

  it("keeps the session when the refresh fails on the network", async () => {
    route((url) => {
      if (url.endsWith("/api/auth/refresh")) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 401 });
    });

    await expect(apiClient.trialBalance("c1", undefined, undefined)).rejects.toBeDefined();

    expect(expired).not.toHaveBeenCalled();
    expect(getStoredAuth()?.refreshToken).toBe("r1");
  });
});
