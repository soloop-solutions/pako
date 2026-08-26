import { ApiException, PakoApiClient } from "@pako/shared";

import { getStoredAuth } from "@/lib/auth-storage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5248";

async function authorizedFetch(url: RequestInfo, init?: RequestInit): Promise<Response> {
  const auth = getStoredAuth();
  const headers = new Headers(init?.headers);
  if (auth) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }

  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 && auth) {
    window.dispatchEvent(new Event("pako:auth-expired"));
  }
  return response;
}

export const apiClient = new PakoApiClient(API_BASE_URL, { fetch: authorizedFetch });

export function getApiErrorMessage(err: unknown, fallback = "Something went wrong."): string {
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
    return err.message || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
