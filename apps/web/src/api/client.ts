import { ApiException, PakoApiClient } from "@pako/shared";

import { en, sq } from "@/i18n/messages";
import { getStoredAuth } from "@/lib/auth-storage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5248";
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

async function authorizedFetch(url: RequestInfo, init?: RequestInit): Promise<Response> {
  const auth = getStoredAuth();
  const headers = new Headers(init?.headers);
  if (auth) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }
  headers.set("Accept-Language", currentLocale());

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
    const raw = err.response?.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string" && parsed) return parsed;
        if (Array.isArray(parsed)) return parsed.join(", ");
      } catch {
        return raw;
      }
    }
    return err.message || fb;
  }
  if (err instanceof Error) return err.message;
  return fb;
}
