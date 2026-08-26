import { ApiException, PakoApiClient } from '@pako/shared';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:5248';

let currentToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  currentToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function authorizedFetch(url: RequestInfo, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }

  const response = await fetch(url, { ...init, headers });
  if (response.status === 401 && currentToken) {
    unauthorizedHandler?.();
  }
  return response;
}

export const apiClient = new PakoApiClient(API_BASE_URL, { fetch: authorizedFetch });

export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof ApiException) {
    const raw = err.response?.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'string' && parsed) return parsed;
        if (Array.isArray(parsed)) return parsed.join(', ');
      } catch {
        return raw;
      }
    }
    return err.message || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
