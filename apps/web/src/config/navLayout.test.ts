import { describe, expect, it } from "vitest";

import { navCategories } from "@/config/nav";
import { applyNavLayout, FIRM_NAV_LAYOUT, NAV_LAYOUT_BY_BUSINESS_TYPE, navLayoutFor, navLayoutScope } from "@/config/navLayout";
import { BusinessType } from "@/lib/business-types";

const categoryIds = navCategories.map((c) => c.id);
const pathsByCategory = new Map(navCategories.map((c) => [c.id, new Set(c.items.map((i) => i.path))]));
const allLayouts = [...Object.entries(NAV_LAYOUT_BY_BUSINESS_TYPE), ["firm", FIRM_NAV_LAYOUT] as const];

describe("nav layout table", () => {
  it.each(allLayouts)("%s names only categories and pages that exist", (_key, layout) => {
    for (const id of layout.categories ?? []) expect(categoryIds).toContain(id);
    for (const [id, paths] of Object.entries(layout.lead ?? {})) {
      expect(categoryIds).toContain(id);
      for (const path of paths) expect(pathsByCategory.get(id)?.has(path), `${id} ${path}`).toBe(true);
    }
    for (const id of Object.keys(layout.visible ?? {})) expect(categoryIds).toContain(id);
  });

  it.each(allLayouts)("%s keeps every page reachable", (_key, layout) => {
    const result = applyNavLayout(navCategories, layout);
    expect(result.map((c) => c.id).sort()).toEqual([...categoryIds].sort());
    for (const category of result) {
      const original = navCategories.find((c) => c.id === category.id)!;
      expect(category.items.map((i) => i.path).sort()).toEqual(original.items.map((i) => i.path).sort());
    }
  });

  it("puts the point of sale and the kitchen pages first for a restaurant", () => {
    const result = applyNavLayout(navCategories, navLayoutFor(BusinessType.Restaurant, false));
    expect(result[0].id).toBe("pos");
    expect(result[0].items.slice(0, 3).map((i) => i.path)).toEqual(["/pos", "/pos/floors", "/pos/menu-setup"]);
    expect(result[0].visibleCount).toBe(6);
  });

  it("puts invoicing first for services and buildings first for real estate", () => {
    expect(applyNavLayout(navCategories, navLayoutFor(BusinessType.Services, false))[0].id).toBe("sales");
    const realEstate = applyNavLayout(navCategories, navLayoutFor(BusinessType.RealEstate, false));
    expect(realEstate[0].id).toBe("projects");
    expect(realEstate[0].items[0].path).toBe("/real-estate/buildings");
  });

  it("leaves the default order for a general company", () => {
    const result = applyNavLayout(navCategories, navLayoutFor(BusinessType.General, false));
    expect(result.map((c) => c.id)).toEqual(categoryIds);
    expect(result.map((c) => c.items.map((i) => i.path))).toEqual(navCategories.map((c) => c.items.map((i) => i.path)));
  });

  it("leads with accounting and reports and promotes the company list for an accounting firm's client", () => {
    const layout = navLayoutFor(BusinessType.Restaurant, true);
    const result = applyNavLayout(navCategories, layout);
    expect(result.slice(0, 2).map((c) => c.id)).toEqual(["accounting", "reports"]);
    expect(layout.topPaths).toEqual(["/companies"]);
  });

  it("keeps stored sidebar customisation of a general company under its original key", () => {
    expect(navLayoutScope(BusinessType.General, false)).toBe("");
    expect(navLayoutScope(null, false)).toBe("");
    expect(navLayoutScope(BusinessType.Restaurant, false)).toBe("t2");
    expect(navLayoutScope(BusinessType.Restaurant, true)).toBe("t2-firm");
  });
});
