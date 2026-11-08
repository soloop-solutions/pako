import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { apiClient } from "@/api/client";
import { AUTH_STORAGE_KEY, clearStoredAuth, getStoredAuth, setStoredAuth, type StoredAuth } from "@/lib/auth-storage";

type AuthContextValue = {
  auth: StoredAuth | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  // docs/USER_ACCESS_PLAN.md: accepting an invitation signs the person in.
  acceptInvitation: (token: string, fullName: string | undefined, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => getStoredAuth());

  useEffect(() => {
    function handleExpired() {
      clearStoredAuth();
      setAuth(null);
    }
    function handleRefreshed() {
      setAuth(getStoredAuth());
    }
    function handleStorage(event: StorageEvent) {
      if (event.key === AUTH_STORAGE_KEY || event.key === null) setAuth(getStoredAuth());
    }
    window.addEventListener("pako:auth-expired", handleExpired);
    window.addEventListener("pako:auth-refreshed", handleRefreshed);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("pako:auth-expired", handleExpired);
      window.removeEventListener("pako:auth-refreshed", handleRefreshed);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  async function login(email: string, password: string) {
    const response = await apiClient.login({ email, password });
    const next = { token: response.token, userId: response.userId, email: response.email, refreshToken: response.refreshToken };
    setStoredAuth(next);
    setAuth(next);
  }

  async function register(email: string, password: string) {
    const response = await apiClient.register({ email, password });
    const next = { token: response.token, userId: response.userId, email: response.email, refreshToken: response.refreshToken };
    setStoredAuth(next);
    setAuth(next);
  }

  async function acceptInvitation(token: string, fullName: string | undefined, password: string) {
    const response = await apiClient.acceptInvitation({ token, fullName, password });
    const next = { token: response.token, userId: response.userId, email: response.email, refreshToken: response.refreshToken };
    setStoredAuth(next);
    setAuth(next);
  }

  function logout() {
    const refreshToken = getStoredAuth()?.refreshToken;
    if (refreshToken) void apiClient.logout({ refreshToken }).catch(() => undefined);
    clearStoredAuth();
    setAuth(null);
  }

  return (
    <AuthContext.Provider value={{ auth, login, register, acceptInvitation, logout }}>{children}</AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
