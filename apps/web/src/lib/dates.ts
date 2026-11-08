export function isoToDate(iso: string | undefined | null): Date | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) || date.getMonth() !== Number(match[2]) - 1 ? undefined : date;
}

export function dateToIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

export function formatDisplayDate(iso: string | undefined | null): string {
  const date = isoToDate(iso);
  if (!date) return "";
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

export function parseTypedDate(text: string): string | null {
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
  const parts = iso ? [iso[1], iso[2], iso[3]] : local ? [local[3], local[2], local[1]] : null;
  if (!parts) return null;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (date.getFullYear() !== Number(parts[0]) || date.getMonth() !== Number(parts[1]) - 1 || date.getDate() !== Number(parts[2])) return null;
  return dateToIso(date);
}

export function isoWithin(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}
