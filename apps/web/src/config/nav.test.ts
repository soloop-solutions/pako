import { describe, expect, it } from "vitest";

import { bottomNavItems, hiddenNavItems, navCategories } from "@/config/nav";

describe("sidebar order", () => {
  it("follows the agreed order: Items, Customers, Sales, Purchases, Bank & Cash, …, Settings last", () => {
    expect(navCategories.map((c) => c.id)).toEqual([
      "items",
      "customers",
      "sales",
      // docs/POS_PLAN.md: the point of sale sits after Sales (placement to confirm).
      "pos",
      // docs/ERP_VERTICALS_PLAN.md (P8): construction, real estate and rentals (placement to confirm).
      "projects",
      "purchases",
      "bankCash",
      "accounting",
      "hr",
      "myHr",
      "reports",
      "administration",
    ]);
    expect(bottomNavItems.at(-1)?.path).toBe("/settings");
  });

  it("keeps every page reachable after the move", () => {
    const sidebarPaths = navCategories.flatMap((c) => c.items.map((i) => i.path));
    const hiddenPaths = hiddenNavItems.map((i) => i.path);
    const allPaths = [...sidebarPaths, ...hiddenPaths];
    for (const path of ["/items", "/customers", "/partner-statement", "/reconciliation", "/ledger", "/vendors"]) {
      expect(sidebarPaths).toContain(path);
    }
    // /partners is hidden from sidebar but still routable
    expect(hiddenPaths).toContain("/partners");
    expect(new Set(allPaths).size).toBe(allPaths.length);
  });
});
