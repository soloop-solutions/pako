// User decision 2026-11-24 ("password on session"): a confirmed action password gives a session token
// (server: ActionTokenService.SessionLifetime) kept here in memory only — a reload or another tab asks
// again, and nothing is written to storage. Keyed by company and action; the server still checks the
// user, so a token never carries over to someone else.
const tokens = new Map<string, { token: string; expiresAt: number }>();
const key = (companyId: string, action: string) => `${companyId}:${action}`;

export function rememberActionToken(companyId: string, action: string, token: string, expiresAtUtc: Date | string | undefined) {
  const expiresAt = expiresAtUtc ? new Date(expiresAtUtc).getTime() : Date.now() + 5 * 60 * 1000;
  tokens.set(key(companyId, action), { token, expiresAt });
}

/** The remembered token, unless it is about to expire (a minute's margin). */
export function sessionActionToken(companyId: string, action: string): string | null {
  const entry = tokens.get(key(companyId, action));
  if (!entry || entry.expiresAt - 60_000 < Date.now()) return null;
  return entry.token;
}

export function forgetActionToken(companyId: string, action: string) {
  tokens.delete(key(companyId, action));
}

/** Forget every remembered token (logout; tests). */
export function clearActionTokens() {
  tokens.clear();
}
