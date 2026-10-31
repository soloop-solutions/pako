import { describe, expect, it } from "vitest";

import { bottomNavItems, navCategories } from "@/config/nav";

describe("sidebar order", () => {
  it("follows the agreed order: Items, Customers, Sales, Purchases, Bank & Cash, …, Settings last", () => {
    expect(navCategories.map((c) => c.id)).toEqual([
      "items",
      "customers",
      "sales",
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
    const paths = navCategories.flatMap((c) => c.items.map((i) => i.path));
    for (const path of ["/items", "/customers", "/partners", "/partner-statement", "/reconciliation", "/ledger", "/vendors"]) {
      expect(paths).toContain(path);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });
});
