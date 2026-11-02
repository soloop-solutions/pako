import type { IntlShape } from "react-intl";

// Business types and vertical packs. The server decides what a company has: it applies a type's
// preset when the company is created or its type is changed, and refuses (403) a pack's endpoints
// while the pack is off. This table is for display only — labels, descriptions, the preview of what
// a type switches on.

/** Mirrors the backend's BusinessType enum. */
export const BusinessType = {
  General: 0,
  Market: 1,
  Restaurant: 2,
  Hotel: 3,
  Services: 4,
  Pharmacy: 5,
  FuelStation: 6,
  Wholesale: 7,
  Construction: 8,
  RealEstate: 9,
  AutoParts: 10,
} as const;

export type BusinessTypeValue = (typeof BusinessType)[keyof typeof BusinessType];

/** The order business types are offered in (General last: it switches everything on). */
export const BUSINESS_TYPES: BusinessTypeValue[] = [
  BusinessType.Market,
  BusinessType.Restaurant,
  BusinessType.Hotel,
  BusinessType.Services,
  BusinessType.Pharmacy,
  BusinessType.FuelStation,
  BusinessType.Wholesale,
  BusinessType.Construction,
  BusinessType.RealEstate,
  BusinessType.AutoParts,
  BusinessType.General,
];

/** Every vertical pack, as the server names them. */
export const PACKS = [
  "grocery",
  "hospitality",
  "services",
  "hotel",
  "events",
  "pharmacy",
  "forecourt",
  "distribution",
  "onlineSales",
  "autoParts",
  "construction",
  "realEstate",
  "rentals",
] as const;

export type Pack = (typeof PACKS)[number];

/** What the server switches on for each business type (display only). */
export const BUSINESS_TYPE_PACKS: Record<BusinessTypeValue, readonly Pack[]> = {
  [BusinessType.General]: PACKS,
  [BusinessType.Market]: ["grocery", "onlineSales"],
  [BusinessType.Restaurant]: ["hospitality", "events"],
  [BusinessType.Hotel]: ["hotel", "hospitality", "events"],
  [BusinessType.Services]: ["services"],
  [BusinessType.Pharmacy]: ["pharmacy", "onlineSales"],
  [BusinessType.FuelStation]: ["forecourt", "grocery"],
  [BusinessType.Wholesale]: ["distribution"],
  [BusinessType.Construction]: ["construction"],
  [BusinessType.RealEstate]: ["realEstate", "rentals"],
  [BusinessType.AutoParts]: ["autoParts", "onlineSales"],
};

const KEYS: Record<BusinessTypeValue, string> = {
  [BusinessType.General]: "general",
  [BusinessType.Market]: "market",
  [BusinessType.Restaurant]: "restaurant",
  [BusinessType.Hotel]: "hotel",
  [BusinessType.Services]: "services",
  [BusinessType.Pharmacy]: "pharmacy",
  [BusinessType.FuelStation]: "fuelStation",
  [BusinessType.Wholesale]: "wholesale",
  [BusinessType.Construction]: "construction",
  [BusinessType.RealEstate]: "realEstate",
  [BusinessType.AutoParts]: "autoParts",
};

/** The message-key segment of a business type (`company.businessType.<key>`); unknown → general. */
export function businessTypeKey(type: number | null | undefined): string {
  return KEYS[(type ?? BusinessType.General) as BusinessTypeValue] ?? KEYS[BusinessType.General];
}

/** The packs a business type's preset switches on; unknown → every pack. */
export function presetPacks(type: number | null | undefined): readonly Pack[] {
  return BUSINESS_TYPE_PACKS[(type ?? BusinessType.General) as BusinessTypeValue] ?? PACKS;
}

/** Packs in display order, keeping only known ones. */
export function sortPacks(features: readonly string[] | null | undefined): Pack[] {
  const set = new Set(features ?? []);
  return PACKS.filter((p) => set.has(p));
}

/** "Grocery, Online sales" — the packs' names in the reader's language. */
export function packList(intl: IntlShape, packs: readonly string[]): string {
  if (packs.length === 0) return intl.formatMessage({ id: "company.packs.none" });
  return intl.formatList(packs.map((p) => intl.formatMessage({ id: `company.pack.${p}`, defaultMessage: p })), { type: "conjunction" });
}

/** A business type's name, e.g. "Hotel / guesthouse". */
export function businessTypeLabel(intl: IntlShape, type: number | null | undefined): string {
  return intl.formatMessage({ id: `company.businessType.${businessTypeKey(type)}` });
}
