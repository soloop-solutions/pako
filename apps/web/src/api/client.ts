import { ApiException, PakoApiClient } from "@pako/shared";

import { en, sq } from "@/i18n/messages";
import { getStoredAuth } from "@/lib/auth-storage";
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

export async function authorizedFetch(url: RequestInfo, init?: RequestInit): Promise<Response> {
  const auth = getStoredAuth();
  const headers = new Headers(init?.headers);
  if (auth) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }
  headers.set("Accept-Language", currentLocale());
  // P3: a waiter signed in with their PIN on a shared till (lib/pos-operator.ts) — the generated
  // client takes no custom headers, so the operator token is added here, to POS requests only.
  const operatorToken = posOperatorTokenFor(typeof url === "string" ? url : url.url);
  if (operatorToken) headers.set(POS_OPERATOR_HEADER, operatorToken);

  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 && auth) {
    window.dispatchEvent(new Event("pako:auth-expired"));
  }
  return response;
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
