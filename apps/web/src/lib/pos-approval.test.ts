import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/client";
import { withPosApproval } from "@/lib/pos-approval";

const order = { clientUuid: "u", sessionId: "ss1", kind: 0, orderedAt: "2026-11-01T13:00:00Z", lines: [], payments: [] };

describe("manager approval header", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("goes out on the one wrapped POS call, and on no call after it", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    const header = (call: number) => new Headers((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].headers).get("X-Pos-Approval");

    await withPosApproval("c1", "ap-token", () => apiClient.submitPosOrder("c1", order));
    await apiClient.submitPosOrder("c1", order);
    await withPosApproval("c1", "ap-token", () => apiClient.submitPosOrder("c2", order));

    expect(header(0)).toBe("ap-token");
    expect(header(1)).toBeNull();
    expect(header(2)).toBeNull();
  });
});
