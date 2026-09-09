import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Receipt,
  Undo2,
  RotateCcw,
  FileClock,
  GitMerge,
  BarChart3,
  Building2,
  Settings as SettingsIcon,
  Users,
  Package,
} from "lucide-react";

import { Bills } from "@/pages/bills/Bills";
import { PurchaseReturns } from "@/pages/bills/PurchaseReturns";
import { Companies } from "@/pages/Companies";
import { Dashboard } from "@/pages/Dashboard";
import { Invoicing } from "@/pages/invoicing/Invoicing";
import { Proforma } from "@/pages/invoicing/Proforma";
import { SalesReturns } from "@/pages/invoicing/SalesReturns";
import { Ledger } from "@/pages/ledger/Ledger";
import { Payroll } from "@/pages/payroll/Payroll";
import { Reconciliation } from "@/pages/reconciliation/Reconciliation";
import { Reports } from "@/pages/Reports";
import { Items } from "@/pages/items/Items";
import { Settings } from "@/pages/Settings";

export type NavItem = {
  titleKey: string;
  descriptionKey: string;
  path: string;
  icon: LucideIcon;
  Element?: ComponentType;
};

// A6 (v2 release): the sidebar now names the document, not the module — "Sales invoices"/
// "Purchase invoices" replace the old "Invoicing"/"Bills" labels (same routes/pages, just
// relabeled — nav.invoicing/nav.bills keys stay in messages.ts, unused, per "add keys, never
// rename"), and Sales returns/Purchase returns/Proforma are new dedicated entries rather than
// document-type options buried inside a single form's dropdown.
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
    titleKey: "nav.salesInvoices",
    path: "/invoicing",
    icon: FileText,
    descriptionKey: "nav.salesInvoices.description",
    Element: Invoicing,
  },
  {
    titleKey: "nav.purchaseInvoices",
    path: "/bills",
    icon: Receipt,
    descriptionKey: "nav.purchaseInvoices.description",
    Element: Bills,
  },
  {
    titleKey: "nav.salesReturns",
    path: "/sales-returns",
    icon: Undo2,
    descriptionKey: "nav.salesReturns.description",
    Element: SalesReturns,
  },
  {
    titleKey: "nav.purchaseReturns",
    path: "/purchase-returns",
    icon: RotateCcw,
    descriptionKey: "nav.purchaseReturns.description",
    Element: PurchaseReturns,
  },
  {
    titleKey: "nav.proforma",
    path: "/proforma",
    icon: FileClock,
    descriptionKey: "nav.proforma.description",
    Element: Proforma,
  },
  {
    titleKey: "nav.items",
    path: "/items",
    icon: Package,
    descriptionKey: "nav.items.description",
    Element: Items,
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
