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
  ListTree,
  BookUser,
  CalendarRange,
  Plus,
} from "lucide-react";

import { Bills } from "@/pages/bills/Bills";
import { PurchaseReturns } from "@/pages/bills/PurchaseReturns";
import { ChartOfAccounts } from "@/pages/ledger/ChartOfAccounts";
import { Companies } from "@/pages/Companies";
import { Dashboard } from "@/pages/Dashboard";
import { Invoicing } from "@/pages/invoicing/Invoicing";
import { Proforma } from "@/pages/invoicing/Proforma";
import { SalesReturns } from "@/pages/invoicing/SalesReturns";
import { Ledger } from "@/pages/ledger/Ledger";
import { Partners } from "@/pages/partners/Partners";
import { Payroll } from "@/pages/payroll/Payroll";
import { Reconciliation } from "@/pages/reconciliation/Reconciliation";
import { Reports } from "@/pages/Reports";
import { Items } from "@/pages/items/Items";
import { Settings } from "@/pages/Settings";
import { YearEnd } from "@/pages/YearEnd";

export type NavItem = {
  titleKey: string;
  descriptionKey: string;
  path: string;
  icon: LucideIcon;
  Element?: ComponentType;
  /** DataGrid id this item's register uses, so a saved view can build `${gridId}.f.<col>=<val>`. */
  gridId?: string;
  savedViews?: NavSavedView[];
};

// A6 (v2 release): the sidebar now names the document, not the module — "Sales invoices"/
// "Purchase invoices" replace the old "Invoicing"/"Bills" labels (same routes/pages, just
// relabeled — nav.invoicing/nav.bills keys stay in messages.ts, unused, per "add keys, never
// rename"), and Sales returns/Purchase returns/Proforma are new dedicated entries rather than
// document-type options buried inside a single form's dropdown.

/**
 * Task 8 (SHELL_SPEC §3): a saved view is a filter on an existing register, applied through the
 * same URL query params `useDataGridUrlState` already reads (`${gridId}.f.${columnId}=${value}`)
 * — never a new page. There is no backend endpoint for the live counts the wireframe shows next
 * to each view (`Të gjitha 1,208 · Draftet 6 ...`); this only builds the filter link and label,
 * with no count shown. See docs/blueprints/sidebar-states.html and the design-handoff README's
 * "Open decisions" §4.
 */
export interface NavSavedView {
  id: string;
  labelKey: string;
  /** Column id -> value, applied as `${gridId}.f.${columnId}`. Empty object = no filter ("all"). */
  filters: Record<string, string>;
}

export interface NavCategory {
  id: string;
  labelKey: string;
  items: NavItem[];
}

/** A pinned action in Favourites that opens a document-creation flow rather than a plain list. */
export interface FavouriteAction {
  id: string;
  labelKey: string;
  path: string;
  icon: LucideIcon;
}

/** Default number of items a category shows before "Shfaq më shumë (N)" hides the rest. */
export const DEFAULT_VISIBLE_COUNT = 4;

const invoiceSavedViews: NavSavedView[] = [
  { id: "all", labelKey: "sidebar.savedView.all", filters: {} },
  { id: "draft", labelKey: "sidebar.savedView.draft", filters: { state: "Draft" } },
  { id: "posted", labelKey: "sidebar.savedView.posted", filters: { state: "Posted" } },
];

const billSavedViews: NavSavedView[] = [
  { id: "all", labelKey: "sidebar.savedView.all", filters: {} },
  { id: "draft", labelKey: "sidebar.savedView.draft", filters: { state: "Draft" } },
  { id: "posted", labelKey: "sidebar.savedView.posted", filters: { state: "Posted" } },
];

const dashboardItem: NavItem = {
  titleKey: "nav.dashboard",
  path: "/dashboard",
  icon: LayoutDashboard,
  descriptionKey: "nav.dashboard.description",
  Element: Dashboard,
};

const companiesItem: NavItem = {
  titleKey: "nav.companies",
  path: "/companies",
  icon: Building2,
  descriptionKey: "nav.companies.description",
  Element: Companies,
};

const settingsItem: NavItem = {
  titleKey: "nav.settings",
  path: "/settings",
  icon: SettingsIcon,
  descriptionKey: "nav.settings.description",
  Element: Settings,
};

const salesInvoicesItem: NavItem = {
  titleKey: "nav.salesInvoices",
  path: "/invoicing",
  icon: FileText,
  descriptionKey: "nav.salesInvoices.description",
  Element: Invoicing,
  gridId: "invoices",
  savedViews: invoiceSavedViews,
};

const purchaseInvoicesItem: NavItem = {
  titleKey: "nav.purchaseInvoices",
  path: "/bills",
  icon: Receipt,
  descriptionKey: "nav.purchaseInvoices.description",
  Element: Bills,
  gridId: "bills",
  savedViews: billSavedViews,
};

const chartOfAccountsItem: NavItem = {
  titleKey: "nav.chartOfAccounts",
  path: "/chart-of-accounts",
  icon: ListTree,
  descriptionKey: "nav.chartOfAccounts.description",
  Element: ChartOfAccounts,
};

/** Top-level items rendered above every category — not part of "Shfaq më shumë" hiding. */
export const topNavItems: NavItem[] = [dashboardItem];

/** Top-level items rendered below every category. */
export const bottomNavItems: NavItem[] = [companiesItem, settingsItem];

export const navCategories: NavCategory[] = [
  {
    id: "sales",
    labelKey: "sidebar.category.sales",
    items: [
      salesInvoicesItem,
      {
        titleKey: "nav.salesReturns",
        path: "/sales-returns",
        icon: Undo2,
        descriptionKey: "nav.salesReturns.description",
        Element: SalesReturns,
      },
      {
        titleKey: "nav.proforma",
        path: "/proforma",
        icon: FileClock,
        descriptionKey: "nav.proforma.description",
        Element: Proforma,
      },
    ],
  },
  {
    id: "purchases",
    labelKey: "sidebar.category.purchases",
    items: [
      purchaseInvoicesItem,
      {
        titleKey: "nav.purchaseReturns",
        path: "/purchase-returns",
        icon: RotateCcw,
        descriptionKey: "nav.purchaseReturns.description",
        Element: PurchaseReturns,
      },
    ],
  },
  {
    id: "accounting",
    labelKey: "sidebar.category.accounting",
    items: [
      {
        titleKey: "nav.ledger",
        path: "/ledger",
        icon: BookOpen,
        descriptionKey: "nav.ledger.description",
        Element: Ledger,
      },
      chartOfAccountsItem,
      {
        titleKey: "nav.reconciliation",
        path: "/reconciliation",
        icon: GitMerge,
        descriptionKey: "nav.reconciliation.description",
        Element: Reconciliation,
      },
    ],
  },
  {
    id: "registers",
    labelKey: "sidebar.category.registers",
    items: [
      {
        titleKey: "nav.items",
        path: "/items",
        icon: Package,
        descriptionKey: "nav.items.description",
        Element: Items,
      },
      {
        titleKey: "nav.partners",
        path: "/partners",
        icon: BookUser,
        descriptionKey: "nav.partners.description",
        Element: Partners,
      },
      {
        titleKey: "nav.payroll",
        path: "/payroll",
        icon: Users,
        descriptionKey: "nav.payroll.description",
        Element: Payroll,
      },
    ],
  },
  {
    id: "reports",
    labelKey: "sidebar.category.reports",
    items: [
      {
        titleKey: "nav.reports",
        path: "/reports",
        icon: BarChart3,
        descriptionKey: "nav.reports.description",
        Element: Reports,
      },
      {
        titleKey: "nav.yearEnd",
        path: "/year-end",
        icon: CalendarRange,
        descriptionKey: "nav.yearEnd.description",
        Element: YearEnd,
      },
    ],
  },
];

/**
 * Fixed create-action shortcuts pinned first in Favourites (SHELL_SPEC §3: "the things people
 * reach for most are new-document actions, not lists"). Both route to the existing register page
 * — neither `/invoicing` nor `/ledger` has a dedicated "new" route today, and the "New invoice" /
 * "New journal entry" forms already render inline at the top of those pages, so landing there is
 * the correct destination without inventing new routes.
 */
export const favouriteActions: FavouriteAction[] = [
  { id: "action:newInvoice", labelKey: "sidebar.action.newInvoice", path: "/invoicing", icon: Plus },
  { id: "action:newJournalEntry", labelKey: "sidebar.action.newJournalEntry", path: "/ledger", icon: Plus },
];

/** Flat list of every routable nav item — used by App.tsx to generate <Route> entries. */
export const navItems: NavItem[] = [
  ...topNavItems,
  ...navCategories.flatMap((category) => category.items),
  ...bottomNavItems,
];
