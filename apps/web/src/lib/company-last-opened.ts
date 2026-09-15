const STORAGE_PREFIX = "pako.lastOpenedCompanies.";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function recordCompanyOpened(userId: string, companyId: string): void {
  try {
    const map = getLastOpenedMap(userId);
    map[companyId] = new Date().toISOString();
    localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    return;
  }
}

export function getLastOpenedMap(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
