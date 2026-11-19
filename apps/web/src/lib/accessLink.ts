const BARE_TOKEN = /^[A-Za-z0-9_-]{20,}$/;

export function parseAccessLink(input: string): string | null {
  const value = input.replace(/\s+/g, "");
  if (!value) return null;
  if (BARE_TOKEN.test(value)) return `/accept-invite?token=${encodeURIComponent(value)}`;

  let url: URL;
  try {
    url = new URL(value, "http://127.0.0.1");
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const token = url.searchParams.get("token");
  if (!token) return null;
  if (url.pathname === "/accept-invite") return `/accept-invite?token=${encodeURIComponent(token)}`;
  if (url.pathname === "/reset-password") {
    const email = url.searchParams.get("email");
    if (!email) return null;
    return `/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  }
  return null;
}
