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
  Building,
  Building2,
  Settings as SettingsIcon,
  UserCheck,
  Truck,
  Package,
  ListTree,
  BookUser,
  CalendarRange,
  Plus,
  BadgePercent,
  UserRound,
  Network,
  Target,
  CalendarDays,
  Wallet,
  FileUser,
  Palmtree,
  IdCard,
  HandCoins,
  Percent,
  ReceiptText,
  Gauge,
  Clock,
  ScrollText,
  ShieldCheck,
  Boxes,
  ArrowLeftRight,
  Warehouse as WarehouseIcon,
  Tags,
  PieChart,
  BadgeEuro,
  ClipboardList,
  MonitorSmartphone,
  Store as StoreIcon,
  Ticket,
  Gift,
  ClipboardCheck,
  LayoutGrid,
  UtensilsCrossed,
  TrendingDown,
  BedDouble,
  Hotel as HotelIcon,
  PartyPopper,
  TicketCheck,
} from "lucide-react";
import { BadgeCheck, CalendarClock, UsersRound, Wrench } from "lucide-react";
// docs/POS_PLAN.md P6 distribution.
import { Calculator, ClipboardPen, Footprints, MapPinned, PackagePlus, Route as RouteIcon } from "lucide-react";
import { SalesOrders } from "@/pages/sales/SalesOrders";
import { SalesRoutes } from "@/pages/distribution/SalesRoutes";
import { MyRouteDay } from "@/pages/distribution/MyRouteDay";
import { RouteVisits } from "@/pages/distribution/RouteVisits";
import { VanLoad, VanSettlement } from "@/pages/distribution/VanSales";

import { Bills } from "@/pages/bills/Bills";
import { PurchaseOrders } from "@/pages/bills/PurchaseOrders";
import { CompanyProfile } from "@/pages/CompanyProfile";
import { PurchaseReturns } from "@/pages/bills/PurchaseReturns";
import { ChartOfAccounts } from "@/pages/ledger/ChartOfAccounts";
import { Companies } from "@/pages/Companies";
import { Dashboard } from "@/pages/Dashboard";
import { Invoicing } from "@/pages/invoicing/Invoicing";
import { Proforma } from "@/pages/invoicing/Proforma";
import { SalesReturns } from "@/pages/invoicing/SalesReturns";
import { Ledger } from "@/pages/ledger/Ledger";
import { Customers } from "@/pages/partners/Customers";
import { Partners } from "@/pages/partners/Partners";
import { Vendors } from "@/pages/partners/Vendors";
import { Payroll } from "@/pages/payroll/Payroll";
import { CommissionPlans } from "@/pages/payroll/CommissionPlans";
import { EmployeeLoans } from "@/pages/payroll/EmployeeLoans";
import { Employees } from "@/pages/hr/Employees";
import { Departments } from "@/pages/hr/Departments";
import { CostCenters } from "@/pages/ledger/CostCenters";
import { Leave } from "@/pages/leave/Leave";
import { MyLeave } from "@/pages/me/MyLeave";
import { MyExpenses } from "@/pages/me/MyExpenses";
import { ExpenseClaims } from "@/pages/hr/ExpenseClaims";
import { FirmPayroll } from "@/pages/hr/FirmPayroll";
import { Timesheets } from "@/pages/hr/Timesheets";
import { PartnerStatement } from "@/pages/partners/PartnerStatement";
import { UsersAndRoles } from "@/pages/admin/UsersAndRoles";
import { MyPayslips } from "@/pages/me/MyPayslips";
import { MyProfile } from "@/pages/me/MyProfile";
import { Reconciliation } from "@/pages/reconciliation/Reconciliation";
import { Reports } from "@/pages/Reports";
import { Items } from "@/pages/items/Items";
import { ItemCategories } from "@/pages/inventory/ItemCategories";
import { PriceLists } from "@/pages/inventory/PriceLists";
import { PosHome } from "@/pages/pos/PosHome";
import { PosSetup } from "@/pages/pos/PosSetup";
import { PosPrograms } from "@/pages/pos/PosPrograms";
import { PosCards } from "@/pages/pos/PosCards";
import { PosReports } from "@/pages/pos/PosReports";
import { CustomerOrders } from "@/pages/pos/CustomerOrders";
import { PosFloors } from "@/pages/pos/PosFloors";
import { MenuSetup } from "@/pages/pos/MenuSetup";
import { UsageVariance } from "@/pages/pos/UsageVariance";
import { PosResources } from "@/pages/pos/PosResources";
import { Appointments } from "@/pages/pos/Appointments";
import { Memberships } from "@/pages/pos/Memberships";
import { Repairs } from "@/pages/pos/Repairs";
import { HotelChart } from "@/pages/pos/hotel/HotelChart";
import { HotelSetup } from "@/pages/pos/hotel/HotelSetup";
import { GuestRegister } from "@/pages/pos/hotel/GuestRegister";
import { Events } from "@/pages/pos/events/Events";
import { TicketedEvents } from "@/pages/pos/events/TicketedEvents";
import { Pill as PharmacyIcon, Fuel as FuelIcon, ShoppingBag as OnlineIcon, CarFront as PartsIcon } from "lucide-react";
import { Pharmacy } from "@/pages/pos/specialist/Pharmacy";
import { Forecourt } from "@/pages/pos/specialist/Forecourt";
import { OnlineSales } from "@/pages/pos/specialist/OnlineSales";
import { PartsSearch } from "@/pages/pos/specialist/PartsSearch";
import { StockDocuments } from "@/pages/inventory/StockDocuments";
import { StockLevels } from "@/pages/inventory/StockLevels";
import { StockReports } from "@/pages/inventory/StockReports";
import { Warehouses } from "@/pages/inventory/Warehouses";
import { Settings } from "@/pages/Settings";
import { WithholdingTax } from "@/pages/tax/WithholdingTax";
import { YearEnd } from "@/pages/YearEnd";
// docs/ERP_VERTICALS_PLAN.md (POS plan P8): construction, real estate sales, property rental.
import { HardHat, Building as BuildingIcon, CalendarCheck, FileSignature, KeyRound, Repeat } from "lucide-react";
import { ConstructionSites } from "@/pages/construction/ConstructionSites";
import { Buildings } from "@/pages/realestate/Buildings";
import { Reservations as UnitReservations } from "@/pages/realestate/Reservations";
import { SaleContracts } from "@/pages/realestate/SaleContracts";
import { Leases } from "@/pages/rentals/Leases";
import { RentRun } from "@/pages/rentals/RentRun";

/**
 * HR module: the department permission a ClientStaff user needs to see an item (mirrors the
 * backend's AccessModule). Unset = visible to everyone with company access. Display only — the
 * API enforces every rule itself.
 */
export type NavModule =
  | "sales"
  | "purchases"
  | "partners"
  | "accounting"
  | "reports"
  | "hr"
  | "self"
  // docs/USER_ACCESS_PLAN.md areas.
  | "items"
  | "payroll"
  | "settings"
  | "users"
  // docs/INVENTORY_PLAN.md D7.
  | "inventory"
  // docs/POS_PLAN.md D14.
  | "pos";

export type NavItem = {
  titleKey: string;
  /** Overrides the category's module for this one item. */
  module?: NavModule;
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
  /** Default NavModule for every item in the category. */
  module?: NavModule;
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

const salesReturnSavedViews: NavSavedView[] = [
  { id: "all", labelKey: "sidebar.savedView.all", filters: {} },
  { id: "draft", labelKey: "sidebar.savedView.draft", filters: { state: "Draft" } },
  { id: "posted", labelKey: "sidebar.savedView.posted", filters: { state: "Posted" } },
];

const purchaseReturnSavedViews: NavSavedView[] = [
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

const companyProfileItem: NavItem = {
  titleKey: "nav.companyProfile",
  path: "/company-profile",
  icon: Building,
  descriptionKey: "nav.companyProfile.description",
  Element: CompanyProfile,
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
export const bottomNavItems: NavItem[] = [companyProfileItem, companiesItem, settingsItem];

// Sidebar order agreed with the product owner (2026-10-30): Favourites, Items, Customers, Sales,
// Purchases, Bank & Cash, then Accounting, HR, My HR, Reports, Administration; Settings sits in the
// bottom items. Favourites and the Dashboard link are rendered by the Sidebar above these.
export const navCategories: NavCategory[] = [
  {
    id: "items",
    labelKey: "sidebar.category.itemsStock",
    items: [
      {
        titleKey: "nav.items",
        path: "/items",
        icon: Package,
        descriptionKey: "nav.items.description",
        Element: Items,
        module: "items",
      },
      // docs/INVENTORY_PLAN.md §5: stock screens, behind the Inventory module and access area.
      { titleKey: "nav.stockLevels", path: "/stock", icon: Boxes, descriptionKey: "nav.stockLevels.description", Element: StockLevels, module: "inventory", gridId: "stock-levels" },
      { titleKey: "nav.stockDocuments", path: "/stock-documents", icon: ArrowLeftRight, descriptionKey: "nav.stockDocuments.description", Element: StockDocuments, module: "inventory", gridId: "stock-documents" },
      { titleKey: "nav.stockReports", path: "/stock-reports", icon: PieChart, descriptionKey: "nav.stockReports.description", Element: StockReports, module: "inventory" },
      { titleKey: "nav.warehouses", path: "/warehouses", icon: WarehouseIcon, descriptionKey: "nav.warehouses.description", Element: Warehouses, module: "inventory" },
      { titleKey: "nav.priceLists", path: "/price-lists", icon: BadgeEuro, descriptionKey: "nav.priceLists.description", Element: PriceLists, module: "items", gridId: "price-list-items" },
      { titleKey: "nav.itemCategories", path: "/item-categories", icon: Tags, descriptionKey: "nav.itemCategories.description", Element: ItemCategories, module: "items" },
    ],
  },
  {
    // Customers and the partner statement (Konsumatorët); Partners page kept as a route but removed
    // from sidebar — accountants work with Customers and Vendors as separate lists.
    id: "customers",
    labelKey: "sidebar.category.customers",
    items: [
      {
        titleKey: "nav.customers",
        path: "/customers",
        icon: UserCheck,
        descriptionKey: "nav.customers.description",
        Element: Customers,
        module: "sales",
      },
      {
        titleKey: "nav.partnerStatement",
        path: "/partner-statement",
        icon: ScrollText,
        descriptionKey: "nav.partnerStatement.description",
        Element: PartnerStatement,
        module: "partners",
      },
    ],
  },
  {
    id: "sales",
    labelKey: "sidebar.category.sales",
    module: "sales",
    items: [
      salesInvoicesItem,
      {
        titleKey: "nav.salesReturns",
        path: "/sales-returns",
        icon: Undo2,
        descriptionKey: "nav.salesReturns.description",
        Element: SalesReturns,
        gridId: "salesReturns",
        savedViews: salesReturnSavedViews,
      },
      {
        titleKey: "nav.proforma",
        path: "/proforma",
        icon: FileClock,
        descriptionKey: "nav.proforma.description",
        Element: Proforma,
      },
      // docs/POS_PLAN.md P6 distribution: quotes and sales orders, routes, the salesperson's day,
      // visits, and the van's morning load and evening settlement (vans are warehouses: Inventory).
      { titleKey: "nav.salesOrders", path: "/sales-orders", icon: ClipboardPen, descriptionKey: "nav.salesOrders.description", Element: SalesOrders, gridId: "sales-orders" },
      { titleKey: "nav.myRouteDay", path: "/distribution/my-day", icon: MapPinned, descriptionKey: "nav.myRouteDay.description", Element: MyRouteDay },
      { titleKey: "nav.salesRoutes", path: "/distribution/routes", icon: RouteIcon, descriptionKey: "nav.salesRoutes.description", Element: SalesRoutes, gridId: "sales-routes" },
      { titleKey: "nav.routeVisits", path: "/distribution/visits", icon: Footprints, descriptionKey: "nav.routeVisits.description", Element: RouteVisits, gridId: "route-visits" },
      { titleKey: "nav.vanLoad", path: "/distribution/van-load", icon: PackagePlus, descriptionKey: "nav.vanLoad.description", Element: VanLoad, module: "inventory", gridId: "van-load" },
      { titleKey: "nav.vanSettlement", path: "/distribution/van-settlement", icon: Calculator, descriptionKey: "nav.vanSettlement.description", Element: VanSettlement, module: "inventory", gridId: "van-settlement" },
    ],
  },
  {
    // docs/POS_PLAN.md: the point of sale, after Sales.
    id: "pos",
    labelKey: "sidebar.category.pos",
    module: "pos",
    items: [
      { titleKey: "nav.pos", path: "/pos", icon: MonitorSmartphone, descriptionKey: "nav.pos.description", Element: PosHome, gridId: "pos-orders" },
      { titleKey: "nav.posSetup", path: "/pos/setup", icon: StoreIcon, descriptionKey: "nav.posSetup.description", Element: PosSetup },
      // P2: promotions, coupons, loyalty; loyalty cards and gift cards.
      { titleKey: "nav.posPrograms", path: "/pos/programs", icon: Ticket, descriptionKey: "nav.posPrograms.description", Element: PosPrograms },
      { titleKey: "nav.posCards", path: "/pos/cards", icon: Gift, descriptionKey: "nav.posCards.description", Element: PosCards },
      // P2: layaways and special orders; store reporting.
      { titleKey: "nav.posCustomerOrders", path: "/pos/customer-orders", icon: ClipboardCheck, descriptionKey: "nav.posCustomerOrders.description", Element: CustomerOrders, gridId: "pos-customer-orders" },
      { titleKey: "nav.posReports", path: "/pos/reports", icon: BarChart3, descriptionKey: "nav.posReports.description", Element: PosReports, gridId: "pos-sales-report" },
      // P3 restaurant back office: floors and tables (QR menu codes), menu setup, usage variance.
      { titleKey: "pos.setup3.nav.floors", path: "/pos/floors", icon: LayoutGrid, descriptionKey: "pos.setup3.nav.floors.description", Element: PosFloors, gridId: "pos-floors" },
      { titleKey: "pos.setup3.nav.menu", path: "/pos/menu-setup", icon: UtensilsCrossed, descriptionKey: "pos.setup3.nav.menu.description", Element: MenuSetup },
      { titleKey: "pos.setup3.nav.variance", path: "/pos/usage-variance", icon: TrendingDown, descriptionKey: "pos.setup3.nav.variance.description", Element: UsageVariance, gridId: "pos-usage-variance" },
      // P4 services: appointments calendar, resources, packages and memberships, repairs.
      { titleKey: "svc.nav.appointments", path: "/pos/appointments", icon: CalendarClock, descriptionKey: "svc.nav.appointments.description", Element: Appointments },
      { titleKey: "svc.nav.resources", path: "/pos/resources", icon: UsersRound, descriptionKey: "svc.nav.resources.description", Element: PosResources, gridId: "pos-resources" },
      { titleKey: "svc.nav.memberships", path: "/pos/memberships", icon: BadgeCheck, descriptionKey: "svc.nav.memberships.description", Element: Memberships, gridId: "pos-memberships" },
      { titleKey: "svc.nav.repairs", path: "/pos/repairs", icon: Wrench, descriptionKey: "svc.nav.repairs.description", Element: Repairs, gridId: "pos-repairs" },
      // P5 hotel and venues: reservation chart, rooms setup, guest register; events; ticketed events.
      { titleKey: "hotel.nav.chart", path: "/pos/hotel", icon: BedDouble, descriptionKey: "hotel.nav.chart.description", Element: HotelChart, gridId: "pos-hotel-unassigned" },
      { titleKey: "hotel.nav.setup", path: "/pos/hotel/setup", icon: HotelIcon, descriptionKey: "hotel.nav.setup.description", Element: HotelSetup },
      { titleKey: "hotel.nav.guests", path: "/pos/hotel/guests", icon: IdCard, descriptionKey: "hotel.nav.guests.description", Element: GuestRegister, gridId: "pos-guest-register" },
      { titleKey: "hotel.nav.events", path: "/pos/events", icon: PartyPopper, descriptionKey: "hotel.nav.events.description", Element: Events, gridId: "pos-events" },
      { titleKey: "hotel.nav.tickets", path: "/pos/tickets", icon: TicketCheck, descriptionKey: "hotel.nav.tickets.description", Element: TicketedEvents, gridId: "pos-ticketed-events" },
      // P7 specialist retail: pharmacy, fuel station, online channels, auto parts (items access).
      { titleKey: "spec.nav.pharmacy", path: "/pos/pharmacy", icon: PharmacyIcon, descriptionKey: "spec.nav.pharmacy.description", Element: Pharmacy, gridId: "pos-prescriptions" },
      { titleKey: "spec.nav.forecourt", path: "/pos/forecourt", icon: FuelIcon, descriptionKey: "spec.nav.forecourt.description", Element: Forecourt },
      { titleKey: "spec.nav.online", path: "/pos/online", icon: OnlineIcon, descriptionKey: "spec.nav.online.description", Element: OnlineSales, gridId: "pos-channel-orders" },
      { titleKey: "spec.nav.parts", path: "/pos/parts", icon: PartsIcon, descriptionKey: "spec.nav.parts.description", Element: PartsSearch, module: "items" },
    ],
  },
  {
    // docs/ERP_VERTICALS_PLAN.md (POS plan P8): projects — construction sites, buildings for sale and
    // rentals, all behind the Sales access area.
    id: "projects",
    labelKey: "vx.sidebar.projects",
    module: "sales",
    items: [
      { titleKey: "vx.nav.sites", path: "/construction", icon: HardHat, descriptionKey: "vx.nav.sites.description", Element: ConstructionSites, gridId: "construction-sites" },
      { titleKey: "vx.nav.buildings", path: "/real-estate/buildings", icon: BuildingIcon, descriptionKey: "vx.nav.buildings.description", Element: Buildings, gridId: "buildings" },
      { titleKey: "vx.nav.reservations", path: "/real-estate/reservations", icon: CalendarCheck, descriptionKey: "vx.nav.reservations.description", Element: UnitReservations, gridId: "unit-reservations" },
      { titleKey: "vx.nav.contracts", path: "/real-estate/contracts", icon: FileSignature, descriptionKey: "vx.nav.contracts.description", Element: SaleContracts, gridId: "unit-sale-contracts" },
      { titleKey: "vx.nav.leases", path: "/rentals/leases", icon: KeyRound, descriptionKey: "vx.nav.leases.description", Element: Leases, gridId: "leases" },
      { titleKey: "vx.nav.rentRun", path: "/rentals/rent-run", icon: Repeat, descriptionKey: "vx.nav.rentRun.description", Element: RentRun },
    ],
  },
  {
    id: "purchases",
    labelKey: "sidebar.category.purchases",
    module: "purchases",
    items: [
      purchaseInvoicesItem,
      // docs/INVENTORY_PLAN.md §12 P5.
      { titleKey: "nav.purchaseOrders", path: "/purchase-orders", icon: ClipboardList, descriptionKey: "nav.purchaseOrders.description", Element: PurchaseOrders, gridId: "purchase-orders" },
      {
        titleKey: "nav.purchaseReturns",
        path: "/purchase-returns",
        icon: RotateCcw,
        descriptionKey: "nav.purchaseReturns.description",
        Element: PurchaseReturns,
        gridId: "purchaseReturns",
        savedViews: purchaseReturnSavedViews,
      },
      {
        titleKey: "nav.vendors",
        path: "/vendors",
        icon: Truck,
        descriptionKey: "nav.vendors.description",
        Element: Vendors,
      },
    ],
  },
  {
    // Banka & Arka: bank and cash work — reconciliation today, bank statement import next.
    id: "bankCash",
    labelKey: "sidebar.category.bankCash",
    items: [
      {
        titleKey: "nav.reconciliation",
        path: "/reconciliation",
        icon: GitMerge,
        descriptionKey: "nav.reconciliation.description",
        Element: Reconciliation,
        module: "accounting",
      },
    ],
  },
  {
    id: "accounting",
    labelKey: "sidebar.category.accounting",
    module: "accounting",
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
        titleKey: "nav.costCenters",
        path: "/cost-centers",
        icon: Target,
        descriptionKey: "nav.costCenters.description",
        Element: CostCenters,
      },
    ],
  },
  {
    id: "hr",
    labelKey: "sidebar.category.hr",
    module: "hr",
    items: [
      {
        titleKey: "nav.employees",
        path: "/employees",
        icon: UserRound,
        descriptionKey: "nav.employees.description",
        Element: Employees,
      },
      {
        titleKey: "nav.departments",
        path: "/departments",
        icon: Network,
        descriptionKey: "nav.departments.description",
        Element: Departments,
      },
      {
        titleKey: "nav.payroll",
        path: "/payroll",
        icon: Wallet,
        descriptionKey: "nav.payroll.description",
        Element: Payroll,
        module: "payroll",
      },
      {
        titleKey: "nav.employeeLoans",
        path: "/employee-loans",
        icon: HandCoins,
        descriptionKey: "nav.employeeLoans.description",
        Element: EmployeeLoans,
        module: "payroll",
      },
      {
        titleKey: "nav.commissionPlans",
        path: "/commission-plans",
        icon: Percent,
        descriptionKey: "nav.commissionPlans.description",
        Element: CommissionPlans,
        module: "payroll",
      },
      {
        titleKey: "nav.timesheets",
        path: "/timesheets",
        icon: Clock,
        descriptionKey: "nav.timesheets.description",
        Element: Timesheets,
      },
      {
        titleKey: "nav.expenseClaims",
        path: "/expense-claims",
        icon: ReceiptText,
        descriptionKey: "nav.expenseClaims.description",
        Element: ExpenseClaims,
      },
      {
        titleKey: "nav.firmPayroll",
        path: "/firm-payroll",
        icon: Gauge,
        descriptionKey: "nav.firmPayroll.description",
        Element: FirmPayroll,
        module: "payroll",
      },
      {
        titleKey: "nav.leave",
        path: "/leave",
        icon: CalendarDays,
        descriptionKey: "nav.leave.description",
        Element: Leave,
      },
    ],
  },
  {
    // F9 self-service: shown to anyone whose login is linked to an employee of the company.
    id: "myHr",
    labelKey: "sidebar.category.myHr",
    module: "self",
    items: [
      {
        titleKey: "nav.myPayslips",
        path: "/my/payslips",
        icon: FileUser,
        descriptionKey: "nav.myPayslips.description",
        Element: MyPayslips,
      },
      {
        titleKey: "nav.myLeave",
        path: "/my/leave",
        icon: Palmtree,
        descriptionKey: "nav.myLeave.description",
        Element: MyLeave,
      },
      {
        titleKey: "nav.myExpenses",
        path: "/my/expenses",
        icon: ReceiptText,
        descriptionKey: "nav.myExpenses.description",
        Element: MyExpenses,
      },
      {
        titleKey: "nav.myProfile",
        path: "/my/profile",
        icon: IdCard,
        descriptionKey: "nav.myProfile.description",
        Element: MyProfile,
      },
    ],
  },
  {
    id: "reports",
    labelKey: "sidebar.category.reports",
    module: "reports",
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
      {
        titleKey: "nav.withholdingTax",
        path: "/withholding-tax",
        icon: BadgePercent,
        descriptionKey: "nav.withholdingTax.description",
        Element: WithholdingTax,
      },
    ],
  },
  {
    // docs/USER_ACCESS_PLAN.md: the administration dashboard.
    id: "administration",
    labelKey: "sidebar.category.administration",
    module: "users",
    items: [
      {
        titleKey: "nav.usersAndRoles",
        path: "/admin/users",
        icon: ShieldCheck,
        descriptionKey: "nav.usersAndRoles.description",
        Element: UsersAndRoles,
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

/** Routes kept alive but hidden from the sidebar (reachable via URL). */
export const hiddenNavItems: NavItem[] = [
  {
    titleKey: "nav.partners",
    path: "/partners",
    icon: BookUser,
    descriptionKey: "nav.partners.description",
    Element: Partners,
    module: "partners",
  },
];

/** Flat list of every routable nav item — used by App.tsx to generate <Route> entries. */
export const navItems: NavItem[] = [
  ...topNavItems,
  ...navCategories.flatMap((category) => category.items),
  ...bottomNavItems,
  ...hiddenNavItems,
];
