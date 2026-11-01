import { useSyncExternalStore } from "react";

// docs/POS_PLAN.md P3: the waiter signed in on a shared till with their PIN. The till's own
// account stays signed in; the server gives the waiter a short-lived operator token that goes out
// as the X-Pos-Operator header on that company's POS requests (api/client.ts adds it), so orders
// and tabs carry the waiter, not the terminal.
//
// Kept in memory and in sessionStorage — a per-device convenience that a reload keeps and closing
// the tab forgets. Nothing an accountant would miss lives here.

export const POS_OPERATOR_HEADER = "X-Pos-Operator";

export interface PosOperator {
  companyId: string;
  userId: string;
  name: string;
  token: string;
  expiresAt: string;
}

const STORAGE_KEY = "pako.posOperator";
const listeners = new Set<() => void>();

function read(): PosOperator | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PosOperator) : null;
  } catch {
    return null;
  }
}

let current: PosOperator | null = read();

function expired(op: PosOperator): boolean {
  const at = Date.parse(op.expiresAt);
  return Number.isFinite(at) && at <= Date.now();
}

/** The signed-in waiter, or null (an expired token counts as signed out). */
export function getPosOperator(): PosOperator | null {
  // Dropped quietly (no listeners called): this also runs as a render-time snapshot.
  if (current && expired(current)) {
    current = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  return current;
}

export function setPosOperator(op: PosOperator | null): void {
  current = op;
  try {
    if (op) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(op));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the waiter stays signed in for this page only.
  }
  listeners.forEach((l) => l());
}

export function subscribePosOperator(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The operator token for a request URL: only that company's /pos/ endpoints get it. */
export function posOperatorTokenFor(url: string): string | null {
  const op = getPosOperator();
  if (!op) return null;
  return url.includes(`/companies/${op.companyId}/pos/`) ? op.token : null;
}

/** The signed-in waiter, re-rendering on sign-in and sign-out. */
export function usePosOperator(): PosOperator | null {
  return useSyncExternalStore(subscribePosOperator, getPosOperator, getPosOperator);
}
