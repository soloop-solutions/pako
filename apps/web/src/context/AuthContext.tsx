import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { apiClient } from "@/api/client";
import { clearStoredAuth, getStoredAuth, setStoredAuth, type StoredAuth } from "@/lib/auth-storage";

type AuthContextValue = {
  auth: StoredAuth | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
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
    window.addEventListener("pako:auth-expired", handleExpired);
    return () => window.removeEventListener("pako:auth-expired", handleExpired);
  }, []);

  async function login(email: string, password: string) {
    const response = await apiClient.login({ email, password });
    const next = { token: response.token, userId: response.userId, email: response.email };
    setStoredAuth(next);
    setAuth(next);
  }

  async function register(email: string, password: string) {
    const response = await apiClient.register({ email, password });
    const next = { token: response.token, userId: response.userId, email: response.email };
    setStoredAuth(next);
    setAuth(next);
  }

  function logout() {
    clearStoredAuth();
    setAuth(null);
  }

  return (
    <AuthContext.Provider value={{ auth, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
