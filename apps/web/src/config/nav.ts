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
  title: string;
  path: string;
  icon: LucideIcon;
  description: string;
  Element?: ComponentType;
};

export const navItems: NavItem[] = [
  {
    title: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
    description: "Overview of the active company's financial position.",
    Element: Dashboard,
  },
  {
    title: "Ledger",
    path: "/ledger",
    icon: BookOpen,
    description: "Chart of accounts, journals, and journal entries.",
    Element: Ledger,
  },
  {
    title: "Invoicing",
    path: "/invoicing",
    icon: FileText,
    description: "Customer invoices (accounts receivable).",
    Element: Invoicing,
  },
  {
    title: "Bills",
    path: "/bills",
    icon: Receipt,
    description: "Vendor bills (accounts payable).",
    Element: Bills,
  },
  {
    title: "Reconciliation",
    path: "/reconciliation",
    icon: GitMerge,
    description: "Match payments against invoices and bills.",
    Element: Reconciliation,
  },
  {
    title: "Payroll",
    path: "/payroll",
    icon: Users,
    description: "Employees and payroll runs.",
    Element: Payroll,
  },
  {
    title: "Reports",
    path: "/reports",
    icon: BarChart3,
    description: "Balance sheet, P&L, and VAT return.",
    Element: Reports,
  },
  {
    title: "Companies",
    path: "/companies",
    icon: Building2,
    description: "Switch between companies and manage firm-client access.",
    Element: Companies,
  },
  {
    title: "Settings",
    path: "/settings",
    icon: SettingsIcon,
    description: "Company, user, and platform settings.",
    Element: Settings,
  },
];
