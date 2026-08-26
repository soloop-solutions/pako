import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'pako.activeCompanyId';

export async function getStoredActiveCompanyId(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEY);
}

export async function setStoredActiveCompanyId(id: string): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, id);
}

export async function clearStoredActiveCompanyId(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
