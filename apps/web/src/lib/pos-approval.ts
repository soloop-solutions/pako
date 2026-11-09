export const POS_APPROVAL_HEADER = "X-Pos-Approval";

let pending: { companyId: string; token: string } | null = null;

/**
 * Runs one API call carrying a manager's approval token (docs/POS_PLAN.md D14). The generated client
 * starts its request synchronously, so the header reaches exactly this call and never a request
 * another part of the till sends in between.
 */
export function withPosApproval<T>(companyId: string, token: string, run: () => T): T {
  pending = { companyId, token };
  try {
    return run();
  } finally {
    pending = null;
  }
}

export function posApprovalTokenFor(url: string): string | null {
  if (!pending) return null;
  return url.includes(`/companies/${pending.companyId}/pos/`) ? pending.token : null;
}
