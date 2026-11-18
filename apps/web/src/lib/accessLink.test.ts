import { describe, expect, it } from "vitest";

import { parseAccessLink } from "@/lib/accessLink";

const token = "invite-".padEnd(43, "x");

describe("parseAccessLink", () => {
  it("reads a full invitation link", () => {
    expect(parseAccessLink(`http://127.0.0.1:6123/accept-invite?token=${token}`)).toBe(`/accept-invite?token=${token}`);
  });

  it("reads a full reset link and keeps the email", () => {
    const resetToken = ["reset", "part"].join("+") + "/==";
    const url = `http://127.0.0.1:6123/reset-password?email=${encodeURIComponent("ana@firma.test")}&token=${encodeURIComponent(resetToken)}`;
    const path = parseAccessLink(url)!;
    const parsed = new URL(path, "http://x");
    expect(parsed.pathname).toBe("/reset-password");
    expect(parsed.searchParams.get("email")).toBe("ana@firma.test");
    expect(parsed.searchParams.get("token")).toBe(resetToken);
  });

  it("accepts a link with another origin and the same path", () => {
    expect(parseAccessLink(`http://localhost:5173/accept-invite?token=${token}`)).toBe(`/accept-invite?token=${token}`);
    expect(parseAccessLink(`https://app.pako.test/accept-invite?token=${token}`)).toBe(`/accept-invite?token=${token}`);
  });

  it("treats a bare token as an invitation token", () => {
    expect(parseAccessLink(token)).toBe(`/accept-invite?token=${token}`);
  });

  it("ignores surrounding and wrapped whitespace", () => {
    expect(parseAccessLink(`  \n${token}\t `)).toBe(`/accept-invite?token=${token}`);
    expect(parseAccessLink(` http://127.0.0.1:6123/accept-invite?to\nken=${token} `)).toBe(`/accept-invite?token=${token}`);
  });

  it("rejects garbage", () => {
    expect(parseAccessLink("")).toBeNull();
    expect(parseAccessLink("   ")).toBeNull();
    expect(parseAccessLink("hello")).toBeNull();
    expect(parseAccessLink("not a link at all, sorry")).toBeNull();
    expect(parseAccessLink("http://127.0.0.1:6123/invoicing?token=abc")).toBeNull();
    expect(parseAccessLink("http://127.0.0.1:6123/accept-invite")).toBeNull();
    expect(parseAccessLink("http://127.0.0.1:6123/reset-password?token=abc")).toBeNull();
    expect(parseAccessLink("javascript:alert(1)")).toBeNull();
    expect(parseAccessLink("<script>alert(1)</script>")).toBeNull();
  });
});
