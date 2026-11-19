/** Albanian month names (1-indexed: index 0 is unused). */
export const ALBANIAN_MONTHS = [
  "",
  "Janar",
  "Shkurt",
  "Mars",
  "Prill",
  "Maj",
  "Qershor",
  "Korrik",
  "Gusht",
  "Shtator",
  "Tetor",
  "N\u00ebntor",
  "Dhjetor",
] as const;

export const ENGLISH_MONTHS = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function monthName(month: number, locale: string): string {
  const names = locale === "sq" ? ALBANIAN_MONTHS : ENGLISH_MONTHS;
  return names[month] ?? "";
}
