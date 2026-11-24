export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .toLowerCase()
    .trim();
}

export function matchesSearch(query: string, ...fields: Array<string | undefined | null>): boolean {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeSearch(fields.filter(Boolean).join(" "));
  return tokens.every((token) => haystack.includes(token));
}
