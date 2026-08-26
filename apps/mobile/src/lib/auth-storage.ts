import * as SecureStore from 'expo-secure-store';

export type StoredAuth = {
  token: string;
  userId: string;
  email: string;
};

const STORAGE_KEY = 'pako.auth';

export async function getStoredAuth(): Promise<StoredAuth | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export async function setStoredAuth(auth: StoredAuth): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(auth));
}

export async function clearStoredAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
