import type { LucideIcon } from "lucide-react";
import { FileText, LayoutDashboard, Receipt, Users } from "lucide-react";

import { navItems } from "@/config/nav";

export type TabKind = "singleton" | "instance";

export interface TabResolution {
  id: string;
  kind: TabKind;
  icon: LucideIcon;
  titleKey?: string;
  fallbackTitleKey?: string;
}

interface InstanceRoute {
  pattern: RegExp;
  icon: LucideIcon;
  fallbackTitleKey: string;
}

// Every route that opens as its own tab instance (one tab per record), rather than a singleton
// register/report tab. Add a pattern here whenever a new document detail route is introduced.
const instanceRoutes: InstanceRoute[] = [
  { pattern: /^\/invoicing\/[^/]+$/, icon: FileText, fallbackTitleKey: "invoiceDetail.draftInvoice" },
  { pattern: /^\/bills\/[^/]+$/, icon: Receipt, fallbackTitleKey: "billDetail.draftBill" },
  { pattern: /^\/payroll\/[^/]+$/, icon: Users, fallbackTitleKey: "payrollRunDetail.title" },
];

// Routes that never get a tab of their own — auth screens sit outside the workspace shell.
const untabbedPaths = new Set(["/login", "/register"]);

export function resolveTab(pathname: string): TabResolution | null {
  if (untabbedPaths.has(pathname)) return null;

  for (const route of instanceRoutes) {
    if (route.pattern.test(pathname)) {
      return { id: pathname, kind: "instance", icon: route.icon, fallbackTitleKey: route.fallbackTitleKey };
    }
  }

  const navItem = navItems.find((item) => item.path === pathname);
  if (navItem) {
    return { id: navItem.path, kind: "singleton", icon: navItem.icon, titleKey: navItem.titleKey };
  }

  if (pathname === "/") {
    return { id: "/", kind: "singleton", icon: LayoutDashboard, titleKey: "landing.title" };
  }

  return null;
}
