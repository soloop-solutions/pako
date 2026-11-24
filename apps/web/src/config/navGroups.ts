import type { NavCategory, NavItem } from "@/config/nav";

// Client request 2026-11-24: menu groups by kind of work. Each lists the paths of existing pages
// (a page may sit in several groups), so no route is added. Which groups a user sees comes from
// the server (MyAccessResponse.menuGroups, Pako.Domain.Companies.MenuGroups), chosen from the
// user's role; each page is still checked against the user's module access like anywhere else.
export const MENU_GROUP_PATHS: Record<string, string[]> = {
  sales: [
    "/distribution/my-day", "/sales-orders", "/invoicing", "/proforma", "/sales-returns", "/customers",
    "/partner-statement", "/discount-rules", "/distribution/van-load", "/distribution/van-settlement", "/distribution/visits",
  ],
  warehouse: [
    "/stock", "/stock-documents", "/purchase-orders", "/distribution/van-load", "/warehouses", "/vehicles", "/stock-reports", "/items",
  ],
  cashier: ["/pos", "/pos/customer-orders", "/bank-statements", "/reconciliation", "/pos/reports"],
  purchasing: ["/purchase-orders", "/bills", "/purchase-returns", "/vendors", "/items", "/price-lists"],
  accountant: [
    "/ledger", "/invoicing", "/bills", "/bank-statements", "/reconciliation", "/reports", "/withholding-tax",
    "/period-closing", "/accounting-documents", "/fixed-assets", "/chart-of-accounts",
  ],
  manager: ["/dashboard", "/invoicing", "/bills", "/reports", "/partner-statement", "/stock"],
};

export const MENU_GROUP_PREFIX = "group:";

/** The sidebar sections for the user's groups, in the server's order, built from the nav items. */
export function menuGroupCategories(groups: readonly string[] | undefined, itemsByPath: ReadonlyMap<string, NavItem>): NavCategory[] {
  return (groups ?? [])
    .filter((group) => group in MENU_GROUP_PATHS)
    .map((group) => ({
      id: `${MENU_GROUP_PREFIX}${group}`,
      labelKey: `menuGroup.${group}`,
      items: MENU_GROUP_PATHS[group].map((path) => itemsByPath.get(path)).filter((item): item is NavItem => !!item),
      visibleCount: 6,
    }))
    .filter((category) => category.items.length > 0);
}
