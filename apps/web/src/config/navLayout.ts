import { BusinessType, type BusinessTypeValue } from "@/lib/business-types";
import { DEFAULT_VISIBLE_COUNT, type NavCategory } from "@/config/nav";

export interface NavLayout {
  categories?: readonly string[];
  lead?: Readonly<Record<string, readonly string[]>>;
  visible?: Readonly<Record<string, number>>;
  topPaths?: readonly string[];
}

export const NAV_LAYOUT_BY_BUSINESS_TYPE: Record<BusinessTypeValue, NavLayout> = {
  [BusinessType.General]: {},

  [BusinessType.Market]: {
    categories: ["pos", "items", "sales", "customers", "purchases"],
    lead: {
      pos: ["/pos", "/pos/customer-orders", "/pos/programs", "/pos/cards", "/pos/reports", "/pos/online"],
      items: ["/items", "/stock", "/price-lists", "/stock-documents"],
    },
    visible: { pos: 5 },
  },

  [BusinessType.Restaurant]: {
    categories: ["pos", "items", "purchases", "sales", "customers"],
    lead: {
      pos: ["/pos", "/pos/floors", "/pos/menu-setup", "/pos/customer-orders", "/pos/usage-variance", "/pos/reports"],
      items: ["/items", "/stock", "/stock-documents", "/warehouses"],
      purchases: ["/purchase-orders", "/bills", "/vendors"],
    },
    visible: { pos: 6 },
  },

  [BusinessType.Hotel]: {
    categories: ["pos", "sales", "items", "customers", "purchases"],
    lead: {
      pos: ["/pos/hotel", "/pos/hotel/guests", "/pos", "/pos/floors", "/pos/events", "/pos/tickets", "/pos/hotel/setup"],
      sales: ["/invoicing", "/proforma", "/sales-orders"],
    },
    visible: { pos: 7 },
  },

  [BusinessType.Services]: {
    categories: ["sales", "pos", "customers", "purchases", "items"],
    lead: {
      sales: ["/invoicing", "/proforma", "/sales-orders", "/sales-returns"],
      pos: ["/pos/appointments", "/pos/resources", "/pos/memberships", "/pos/repairs", "/pos"],
      customers: ["/customers", "/partner-statement"],
    },
    visible: { pos: 5 },
  },

  [BusinessType.Pharmacy]: {
    categories: ["pos", "items", "purchases", "sales", "customers"],
    lead: {
      pos: ["/pos", "/pos/pharmacy", "/pos/online", "/pos/customer-orders", "/pos/reports"],
      items: ["/items", "/stock", "/stock-documents", "/price-lists"],
    },
    visible: { pos: 5 },
  },

  [BusinessType.FuelStation]: {
    categories: ["pos", "items", "purchases", "sales", "customers"],
    lead: {
      pos: ["/pos", "/pos/forecourt", "/pos/reports", "/pos/cards"],
      items: ["/items", "/stock", "/stock-documents", "/price-lists"],
    },
  },

  [BusinessType.Wholesale]: {
    categories: ["sales", "items", "customers", "purchases"],
    lead: {
      sales: ["/invoicing", "/sales-orders", "/distribution/my-day", "/distribution/routes", "/distribution/visits", "/distribution/van-load", "/distribution/van-settlement"],
      items: ["/items", "/stock", "/price-lists", "/stock-documents"],
    },
    visible: { sales: 7 },
  },

  [BusinessType.Construction]: {
    categories: ["projects", "purchases", "sales", "items", "customers"],
    lead: {
      projects: ["/construction"],
      purchases: ["/bills", "/purchase-orders", "/vendors"],
    },
  },

  [BusinessType.RealEstate]: {
    categories: ["projects", "sales", "customers", "purchases"],
    lead: {
      projects: ["/real-estate/buildings", "/real-estate/reservations", "/real-estate/contracts", "/rentals/leases", "/rentals/rent-run"],
      sales: ["/invoicing", "/proforma"],
    },
    visible: { projects: 5 },
  },

  [BusinessType.AutoParts]: {
    categories: ["pos", "items", "purchases", "sales", "customers"],
    lead: {
      pos: ["/pos", "/pos/parts", "/pos/online", "/pos/customer-orders", "/pos/reports"],
      items: ["/items", "/stock", "/price-lists", "/stock-documents"],
    },
    visible: { pos: 5 },
  },
};

export const FIRM_NAV_LAYOUT: NavLayout = {
  categories: ["accounting", "reports", "bankCash", "sales", "purchases"],
  lead: {
    accounting: ["/ledger", "/chart-of-accounts", "/cost-centers"],
    reports: ["/reports", "/year-end", "/withholding-tax"],
  },
  topPaths: ["/companies"],
};

export function navLayoutFor(businessType: number | null, isFirmClient: boolean): NavLayout {
  const byType = NAV_LAYOUT_BY_BUSINESS_TYPE[(businessType ?? BusinessType.General) as BusinessTypeValue] ?? {};
  if (!isFirmClient) return byType;
  return {
    categories: [...(FIRM_NAV_LAYOUT.categories ?? []), ...(byType.categories ?? [])],
    lead: { ...byType.lead, ...FIRM_NAV_LAYOUT.lead },
    visible: byType.visible,
    topPaths: FIRM_NAV_LAYOUT.topPaths,
  };
}

export function navLayoutScope(businessType: number | null, isFirmClient: boolean): string {
  const type = businessType ?? BusinessType.General;
  const parts = [type !== BusinessType.General ? `t${type}` : "", isFirmClient ? "firm" : ""].filter(Boolean);
  return parts.join("-");
}

function leadFirst<T extends { path: string }>(items: T[], lead: readonly string[] | undefined): T[] {
  if (!lead || lead.length === 0) return items;
  const byPath = new Map(items.map((item) => [item.path, item]));
  const front = lead.map((path) => byPath.get(path)).filter((item): item is T => !!item);
  const frontPaths = new Set(front.map((item) => item.path));
  return [...front, ...items.filter((item) => !frontPaths.has(item.path))];
}

export function applyNavLayout(categories: NavCategory[], layout: NavLayout): NavCategory[] {
  const rank = new Map((layout.categories ?? []).map((id, index) => [id, index]));
  const defaultIndex = new Map(categories.map((category, index) => [category.id, index]));
  const ordered = [...categories].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return (defaultIndex.get(a.id) ?? 0) - (defaultIndex.get(b.id) ?? 0);
  });
  return ordered.map((category) => ({
    ...category,
    items: leadFirst(category.items, layout.lead?.[category.id]),
    visibleCount: layout.visible?.[category.id] ?? DEFAULT_VISIBLE_COUNT,
  }));
}
