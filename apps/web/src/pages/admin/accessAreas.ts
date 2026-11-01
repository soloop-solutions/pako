import type { IntlShape } from "react-intl";
import type { ModuleAccessResponse } from "@pako/shared";

import { navCategories, type NavModule } from "@/config/nav";
import { AccessLevel } from "@/lib/hr-enums";

// docs/USER_ACCESS_PLAN.md §2: the areas a role grants, in the order the matrix shows them.
export const ACCESS_AREAS = [
  "sales",
  "purchases",
  "partners",
  "items",
  "inventory",
  "pos",
  "accounting",
  "reports",
  "hr",
  "payroll",
  "settings",
  "users",
] as const satisfies readonly (keyof ModuleAccessResponse & NavModule)[];

export type AccessArea = (typeof ACCESS_AREAS)[number];

export const ACCESS_LEVELS = [AccessLevel.None, AccessLevel.Read, AccessLevel.Write, AccessLevel.Approve] as const;

const LEVEL_KEYS: Record<number, string> = {
  0: "admin.level.none",
  1: "admin.level.view",
  2: "admin.level.edit",
  3: "admin.level.approve",
};

export function levelLabel(level: number, intl: IntlShape): string {
  return intl.formatMessage({ id: LEVEL_KEYS[level] ?? "admin.level.none" });
}

export function areaLabel(area: AccessArea, intl: IntlShape): string {
  return intl.formatMessage({ id: `admin.area.${area}` });
}

export function emptyLevels(): ModuleAccessResponse {
  return { sales: 0, purchases: 0, partners: 0, accounting: 0, reports: 0, hr: 0, items: 0, payroll: 0, settings: 0, users: 0, inventory: 0, pos: 0 };
}

// Which sidebar pages a set of levels opens — the "what will this person see" preview. The same
// mapping the sidebar itself uses (item module, else its category's).
export function pagesFor(levels: ModuleAccessResponse): { titleKey: string; area: AccessArea; level: number }[] {
  const pages: { titleKey: string; area: AccessArea; level: number }[] = [];
  for (const category of navCategories) {
    for (const item of category.items) {
      const module = (item.module ?? category.module) as NavModule | undefined;
      if (!module || !(ACCESS_AREAS as readonly string[]).includes(module)) continue;
      const level = levels[module as AccessArea] ?? 0;
      if (level > AccessLevel.None) pages.push({ titleKey: item.titleKey, area: module as AccessArea, level });
    }
  }
  return pages;
}
