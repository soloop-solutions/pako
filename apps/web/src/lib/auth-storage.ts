export type StoredAuth = {
  token: string;
  userId: string;
  email: string;
  refreshToken?: string;
};

const STORAGE_KEY = "pako.auth";

export function getStoredAuth(): StoredAuth | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  sessionStorage.removeItem(STORAGE_KEY);
}

export function clearStoredAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

export const AUTH_STORAGE_KEY = STORAGE_KEY;
