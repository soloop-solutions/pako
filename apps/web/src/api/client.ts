import { ApiException, PakoApiClient } from "@pako/shared";

import { en, sq } from "@/i18n/messages";
import { getStoredAuth, setStoredAuth } from "@/lib/auth-storage";
import { POS_APPROVAL_HEADER, posApprovalTokenFor } from "@/lib/pos-approval";
import { POS_OPERATOR_HEADER, posOperatorTokenFor } from "@/lib/pos-operator";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5248";
const LANGUAGE_STORAGE_KEY = "pako.language";

function currentLocale(): string {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "sq") return stored;
  } catch {
    // fallback
  }
  return "en";
}

const ANONYMOUS_AUTH_PATH = /\/api\/auth\/(?!me\b|verify-password\b|action-tokens\b)/;

function urlOf(url: RequestInfo): string {
  return typeof url === "string" ? url : url.url;
}

let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(refreshToken: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      window.dispatchEvent(new Event("pako:auth-expired"));
    }
    return null;
  }
  const body = (await response.json()) as { token: string; userId: string; email: string; refreshToken?: string };
  setStoredAuth({ token: body.token, userId: body.userId, email: body.email, refreshToken: body.refreshToken ?? refreshToken });
  window.dispatchEvent(new Event("pako:auth-refreshed"));
  return body.token;
}

function refreshAccessToken(failedToken: string): Promise<string | null> {
  const current = getStoredAuth();
  if (!current) return Promise.resolve(null);
  if (current.token !== failedToken) return Promise.resolve(current.token);
  if (!current.refreshToken) {
    window.dispatchEvent(new Event("pako:auth-expired"));
    return Promise.resolve(null);
  }
  if (!refreshInFlight) {
    refreshInFlight = performRefresh(current.refreshToken).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function buildHeaders(url: RequestInfo, init: RequestInit | undefined, token: string | null): Headers {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("Accept-Language", currentLocale());
  // P3: a waiter signed in with their PIN on a shared till (lib/pos-operator.ts) — the generated
  // client takes no custom headers, so the operator token is added here, to POS requests only.
  const operatorToken = posOperatorTokenFor(urlOf(url));
  if (operatorToken) headers.set(POS_OPERATOR_HEADER, operatorToken);
  const approvalToken = posApprovalTokenFor(typeof url === "string" ? url : url.url);
  if (approvalToken) headers.set(POS_APPROVAL_HEADER, approvalToken);
  return headers;
}

export async function authorizedFetch(url: RequestInfo, init?: RequestInit): Promise<Response> {
  const auth = getStoredAuth();
  const response = await fetch(url, { ...init, headers: buildHeaders(url, init, auth?.token ?? null) });
  if (response.status !== 401 || !auth || ANONYMOUS_AUTH_PATH.test(urlOf(url))) return response;

  const fresh = await refreshAccessToken(auth.token);
  if (!fresh) return response;
  const retried = await fetch(url, { ...init, headers: buildHeaders(url, init, fresh) });
  if (retried.status === 401) window.dispatchEvent(new Event("pako:auth-expired"));
  return retried;
}

export const apiClient = new PakoApiClient(API_BASE_URL, { fetch: authorizedFetch });

export function getApiErrorMessage(err: unknown, fallback?: string): string {
  const msgs = currentLocale() === "sq" ? sq : en;
  const fb = fallback ?? msgs["errors.somethingWentWrong"];
  if (err instanceof ApiException) {
    // Map common HTTP status codes to user-friendly messages
    if (err.status === 403) return msgs["errors.noPermission"];
    if (err.status === 404) return msgs["errors.notFound"];
    const raw = err.response?.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string" && parsed) return parsed;
        if (Array.isArray(parsed)) return parsed.join(", ");
        // Handle ProblemDetails / validation errors
        if (typeof parsed === "object" && parsed !== null) {
          if (typeof parsed.error === "string" && parsed.error) return parsed.error;
          if (parsed.detail) return parsed.detail;
          if (parsed.title) return parsed.title;
          if (parsed.errors) {
            const fieldErrors = Object.entries(parsed.errors)
              .map(([field, messages]) => `${field}: ${(messages as string[]).join(", ")}`)
              .join("; ");
            return fieldErrors || fb;
          }
        }
      } catch {
        return raw;
      }
    }
    if (err.status === 500) return msgs["errors.serverError"];
    return err.message || fb;
  }
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return msgs["errors.networkError"];
  }
  if (err instanceof Error) return err.message;
  return fb;
}
