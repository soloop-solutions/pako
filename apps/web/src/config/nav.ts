import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Receipt,
  GitMerge,
  BarChart3,
  Building2,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";

import { Bills } from "@/pages/bills/Bills";
import { Companies } from "@/pages/Companies";
import { Dashboard } from "@/pages/Dashboard";
import { Invoicing } from "@/pages/invoicing/Invoicing";
import { Ledger } from "@/pages/ledger/Ledger";
import { Payroll } from "@/pages/payroll/Payroll";
import { Reconciliation } from "@/pages/reconciliation/Reconciliation";
import { Reports } from "@/pages/Reports";
import { Settings } from "@/pages/Settings";

export type NavItem = {
  titleKey: string;
  descriptionKey: string;
  path: string;
  icon: LucideIcon;
  Element?: ComponentType;
};

export const navItems: NavItem[] = [
  {
    titleKey: "nav.dashboard",
    path: "/",
    icon: LayoutDashboard,
    descriptionKey: "nav.dashboard.description",
    Element: Dashboard,
  },
  {
    titleKey: "nav.ledger",
    path: "/ledger",
    icon: BookOpen,
    descriptionKey: "nav.ledger.description",
    Element: Ledger,
  },
  {
    titleKey: "nav.invoicing",
    path: "/invoicing",
    icon: FileText,
    descriptionKey: "nav.invoicing.description",
    Element: Invoicing,
  },
  {
    titleKey: "nav.bills",
    path: "/bills",
    icon: Receipt,
    descriptionKey: "nav.bills.description",
    Element: Bills,
  },
  {
    titleKey: "nav.reconciliation",
    path: "/reconciliation",
    icon: GitMerge,
    descriptionKey: "nav.reconciliation.description",
    Element: Reconciliation,
  },
  {
    titleKey: "nav.payroll",
    path: "/payroll",
    icon: Users,
    descriptionKey: "nav.payroll.description",
    Element: Payroll,
  },
  {
    titleKey: "nav.reports",
    path: "/reports",
    icon: BarChart3,
    descriptionKey: "nav.reports.description",
    Element: Reports,
  },
  {
    titleKey: "nav.companies",
    path: "/companies",
    icon: Building2,
    descriptionKey: "nav.companies.description",
    Element: Companies,
  },
  {
    titleKey: "nav.settings",
    path: "/settings",
    icon: SettingsIcon,
    descriptionKey: "nav.settings.description",
    Element: Settings,
  },
];
