import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { apiClient, setAuthToken, setUnauthorizedHandler } from '@/api/client';
import { clearStoredAuth, getStoredAuth, setStoredAuth, type StoredAuth } from '@/lib/auth-storage';

type AuthContextValue = {
  auth: StoredAuth | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getStoredAuth();
      if (cancelled) return;
      setAuthToken(stored?.token ?? null);
      setAuth(stored);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearStoredAuth();
      setAuthToken(null);
      setAuth(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  async function login(email: string, password: string) {
    const response = await apiClient.login({ email, password });
    const next = { token: response.token, userId: response.userId, email: response.email };
    await setStoredAuth(next);
    setAuthToken(next.token);
    setAuth(next);
  }

  async function register(email: string, password: string) {
    const response = await apiClient.register({ email, password });
    const next = { token: response.token, userId: response.userId, email: response.email };
    await setStoredAuth(next);
    setAuthToken(next.token);
    setAuth(next);
  }

  function logout() {
    void clearStoredAuth();
    setAuthToken(null);
    setAuth(null);
  }

  return <AuthContext.Provider value={{ auth, ready, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
