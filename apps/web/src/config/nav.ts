import { lazy, type ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { Pack } from "@/lib/business-types";
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
// -- Lazy page imports: each page is code-split into its own chunk. --
// Pages use named exports, so we re-export them as `default` for React.lazy.
const SalesOrders = lazy(() => import("@/pages/sales/SalesOrders").then(m => ({ default: m.SalesOrders })));
const SalesRoutes = lazy(() => import("@/pages/distribution/SalesRoutes").then(m => ({ default: m.SalesRoutes })));
const MyRouteDay = lazy(() => import("@/pages/distribution/MyRouteDay").then(m => ({ default: m.MyRouteDay })));
const RouteVisits = lazy(() => import("@/pages/distribution/RouteVisits").then(m => ({ default: m.RouteVisits })));
const VanLoad = lazy(() => import("@/pages/distribution/VanSales").then(m => ({ default: m.VanLoad })));
const VanSettlement = lazy(() => import("@/pages/distribution/VanSales").then(m => ({ default: m.VanSettlement })));

const Bills = lazy(() => import("@/pages/bills/Bills").then(m => ({ default: m.Bills })));
const PurchaseOrders = lazy(() => import("@/pages/bills/PurchaseOrders").then(m => ({ default: m.PurchaseOrders })));
const CompanyProfile = lazy(() => import("@/pages/CompanyProfile").then(m => ({ default: m.CompanyProfile })));
const PurchaseReturns = lazy(() => import("@/pages/bills/PurchaseReturns").then(m => ({ default: m.PurchaseReturns })));
const ChartOfAccounts = lazy(() => import("@/pages/ledger/ChartOfAccounts").then(m => ({ default: m.ChartOfAccounts })));
const Companies = lazy(() => import("@/pages/Companies").then(m => ({ default: m.Companies })));
const Dashboard = lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.Dashboard })));
const Invoicing = lazy(() => import("@/pages/invoicing/Invoicing").then(m => ({ default: m.Invoicing })));
const Proforma = lazy(() => import("@/pages/invoicing/Proforma").then(m => ({ default: m.Proforma })));
const SalesReturns = lazy(() => import("@/pages/invoicing/SalesReturns").then(m => ({ default: m.SalesReturns })));
const Ledger = lazy(() => import("@/pages/ledger/Ledger").then(m => ({ default: m.Ledger })));
const Customers = lazy(() => import("@/pages/partners/Customers").then(m => ({ default: m.Customers })));
const Partners = lazy(() => import("@/pages/partners/Partners").then(m => ({ default: m.Partners })));
const Vendors = lazy(() => import("@/pages/partners/Vendors").then(m => ({ default: m.Vendors })));
const Payroll = lazy(() => import("@/pages/payroll/Payroll").then(m => ({ default: m.Payroll })));
const CommissionPlans = lazy(() => import("@/pages/payroll/CommissionPlans").then(m => ({ default: m.CommissionPlans })));
const EmployeeLoans = lazy(() => import("@/pages/payroll/EmployeeLoans").then(m => ({ default: m.EmployeeLoans })));
const Employees = lazy(() => import("@/pages/hr/Employees").then(m => ({ default: m.Employees })));
const Departments = lazy(() => import("@/pages/hr/Departments").then(m => ({ default: m.Departments })));
const CostCenters = lazy(() => import("@/pages/ledger/CostCenters").then(m => ({ default: m.CostCenters })));
const Leave = lazy(() => import("@/pages/leave/Leave").then(m => ({ default: m.Leave })));
const MyLeave = lazy(() => import("@/pages/me/MyLeave").then(m => ({ default: m.MyLeave })));
const MyExpenses = lazy(() => import("@/pages/me/MyExpenses").then(m => ({ default: m.MyExpenses })));
const ExpenseClaims = lazy(() => import("@/pages/hr/ExpenseClaims").then(m => ({ default: m.ExpenseClaims })));
const FirmPayroll = lazy(() => import("@/pages/hr/FirmPayroll").then(m => ({ default: m.FirmPayroll })));
const Timesheets = lazy(() => import("@/pages/hr/Timesheets").then(m => ({ default: m.Timesheets })));
const PartnerStatement = lazy(() => import("@/pages/partners/PartnerStatement").then(m => ({ default: m.PartnerStatement })));
const UsersAndRoles = lazy(() => import("@/pages/admin/UsersAndRoles").then(m => ({ default: m.UsersAndRoles })));
const MyPayslips = lazy(() => import("@/pages/me/MyPayslips").then(m => ({ default: m.MyPayslips })));
const MyProfile = lazy(() => import("@/pages/me/MyProfile").then(m => ({ default: m.MyProfile })));
const Reconciliation = lazy(() => import("@/pages/reconciliation/Reconciliation").then(m => ({ default: m.Reconciliation })));
const Reports = lazy(() => import("@/pages/Reports").then(m => ({ default: m.Reports })));
const Items = lazy(() => import("@/pages/items/Items").then(m => ({ default: m.Items })));
const ItemCategories = lazy(() => import("@/pages/inventory/ItemCategories").then(m => ({ default: m.ItemCategories })));
const PriceLists = lazy(() => import("@/pages/inventory/PriceLists").then(m => ({ default: m.PriceLists })));
const PosHome = lazy(() => import("@/pages/pos/PosHome").then(m => ({ default: m.PosHome })));
const PosSetup = lazy(() => import("@/pages/pos/PosSetup").then(m => ({ default: m.PosSetup })));
const PosPrograms = lazy(() => import("@/pages/pos/PosPrograms").then(m => ({ default: m.PosPrograms })));
const PosCards = lazy(() => import("@/pages/pos/PosCards").then(m => ({ default: m.PosCards })));
const PosReports = lazy(() => import("@/pages/pos/PosReports").then(m => ({ default: m.PosReports })));
const CustomerOrders = lazy(() => import("@/pages/pos/CustomerOrders").then(m => ({ default: m.CustomerOrders })));
const PosFloors = lazy(() => import("@/pages/pos/PosFloors").then(m => ({ default: m.PosFloors })));
const MenuSetup = lazy(() => import("@/pages/pos/MenuSetup").then(m => ({ default: m.MenuSetup })));
const UsageVariance = lazy(() => import("@/pages/pos/UsageVariance").then(m => ({ default: m.UsageVariance })));
const PosResources = lazy(() => import("@/pages/pos/PosResources").then(m => ({ default: m.PosResources })));
const Appointments = lazy(() => import("@/pages/pos/Appointments").then(m => ({ default: m.Appointments })));
const Memberships = lazy(() => import("@/pages/pos/Memberships").then(m => ({ default: m.Memberships })));
const Repairs = lazy(() => import("@/pages/pos/Repairs").then(m => ({ default: m.Repairs })));
const HotelChart = lazy(() => import("@/pages/pos/hotel/HotelChart").then(m => ({ default: m.HotelChart })));
const HotelSetup = lazy(() => import("@/pages/pos/hotel/HotelSetup").then(m => ({ default: m.HotelSetup })));
const GuestRegister = lazy(() => import("@/pages/pos/hotel/GuestRegister").then(m => ({ default: m.GuestRegister })));
const Events = lazy(() => import("@/pages/pos/events/Events").then(m => ({ default: m.Events })));
const TicketedEvents = lazy(() => import("@/pages/pos/events/TicketedEvents").then(m => ({ default: m.TicketedEvents })));
import { Pill as PharmacyIcon, Fuel as FuelIcon, ShoppingBag as OnlineIcon, CarFront as PartsIcon } from "lucide-react";
const Pharmacy = lazy(() => import("@/pages/pos/specialist/Pharmacy").then(m => ({ default: m.Pharmacy })));
const Forecourt = lazy(() => import("@/pages/pos/specialist/Forecourt").then(m => ({ default: m.Forecourt })));
const OnlineSales = lazy(() => import("@/pages/pos/specialist/OnlineSales").then(m => ({ default: m.OnlineSales })));
const PartsSearch = lazy(() => import("@/pages/pos/specialist/PartsSearch").then(m => ({ default: m.PartsSearch })));
const StockDocuments = lazy(() => import("@/pages/inventory/StockDocuments").then(m => ({ default: m.StockDocuments })));
const StockLevels = lazy(() => import("@/pages/inventory/StockLevels").then(m => ({ default: m.StockLevels })));
const StockReports = lazy(() => import("@/pages/inventory/StockReports").then(m => ({ default: m.StockReports })));
const Warehouses = lazy(() => import("@/pages/inventory/Warehouses").then(m => ({ default: m.Warehouses })));
const Vehicles = lazy(() => import("@/pages/inventory/Vehicles").then(m => ({ default: m.Vehicles })));
const Settings = lazy(() => import("@/pages/Settings").then(m => ({ default: m.Settings })));
const WithholdingTax = lazy(() => import("@/pages/tax/WithholdingTax").then(m => ({ default: m.WithholdingTax })));
const YearEnd = lazy(() => import("@/pages/YearEnd").then(m => ({ default: m.YearEnd })));
// docs/ERP_VERTICALS_PLAN.md (POS plan P8): construction, real estate sales, property rental.
import { HardHat, Building as BuildingIcon, CalendarCheck, FileSignature, KeyRound, Repeat } from "lucide-react";
const ConstructionSites = lazy(() => import("@/pages/construction/ConstructionSites").then(m => ({ default: m.ConstructionSites })));
const Buildings = lazy(() => import("@/pages/realestate/Buildings").then(m => ({ default: m.Buildings })));
const UnitReservations = lazy(() => import("@/pages/realestate/Reservations").then(m => ({ default: m.Reservations })));
const SaleContracts = lazy(() => import("@/pages/realestate/SaleContracts").then(m => ({ default: m.SaleContracts })));
const Leases = lazy(() => import("@/pages/rentals/Leases").then(m => ({ default: m.Leases })));
const RentRun = lazy(() => import("@/pages/rentals/RentRun").then(m => ({ default: m.RentRun })));

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
  /**
   * The vertical pack (or any of several packs) the page belongs to; hidden, and its route shows
   * "not used by this company", while the pack is off for the active company. Unset = always on.
   */
  feature?: Pack | readonly Pack[];
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
  /** How many items show before "Show more"; set by the business-type layout. */
  visibleCount?: number;
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
  module: "settings",
};

const companiesItem: NavItem = {
  titleKey: "nav.companies",
  path: "/companies",
  icon: Building2,
  descriptionKey: "nav.companies.description",
  Element: Companies,
  module: "settings",
};

const settingsItem: NavItem = {
  titleKey: "nav.settings",
  path: "/settings",
  icon: SettingsIcon,
  descriptionKey: "nav.settings.description",
  Element: Settings,
  module: "settings",
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
      { titleKey: "nav.vehicles", path: "/vehicles", icon: Truck, descriptionKey: "nav.vehicles.description", Element: Vehicles, module: "inventory", gridId: "vehicles" },
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
      { titleKey: "nav.myRouteDay", path: "/distribution/my-day", feature: "distribution", icon: MapPinned, descriptionKey: "nav.myRouteDay.description", Element: MyRouteDay },
      { titleKey: "nav.salesRoutes", path: "/distribution/routes", feature: "distribution", icon: RouteIcon, descriptionKey: "nav.salesRoutes.description", Element: SalesRoutes, gridId: "sales-routes" },
      { titleKey: "nav.routeVisits", path: "/distribution/visits", feature: "distribution", icon: Footprints, descriptionKey: "nav.routeVisits.description", Element: RouteVisits, gridId: "route-visits" },
      { titleKey: "nav.vanLoad", path: "/distribution/van-load", feature: "distribution", icon: PackagePlus, descriptionKey: "nav.vanLoad.description", Element: VanLoad, module: "inventory", gridId: "van-load" },
      { titleKey: "nav.vanSettlement", path: "/distribution/van-settlement", feature: "distribution", icon: Calculator, descriptionKey: "nav.vanSettlement.description", Element: VanSettlement, module: "inventory", gridId: "van-settlement" },
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
      { titleKey: "pos.setup3.nav.floors", path: "/pos/floors", feature: "hospitality", icon: LayoutGrid, descriptionKey: "pos.setup3.nav.floors.description", Element: PosFloors, gridId: "pos-floors" },
      { titleKey: "pos.setup3.nav.menu", path: "/pos/menu-setup", feature: "hospitality", icon: UtensilsCrossed, descriptionKey: "pos.setup3.nav.menu.description", Element: MenuSetup },
      { titleKey: "pos.setup3.nav.variance", path: "/pos/usage-variance", feature: "hospitality", icon: TrendingDown, descriptionKey: "pos.setup3.nav.variance.description", Element: UsageVariance, gridId: "pos-usage-variance" },
      // P4 services: appointments calendar, resources, packages and memberships, repairs.
      { titleKey: "svc.nav.appointments", path: "/pos/appointments", feature: "services", icon: CalendarClock, descriptionKey: "svc.nav.appointments.description", Element: Appointments },
      { titleKey: "svc.nav.resources", path: "/pos/resources", feature: "services", icon: UsersRound, descriptionKey: "svc.nav.resources.description", Element: PosResources, gridId: "pos-resources" },
      { titleKey: "svc.nav.memberships", path: "/pos/memberships", feature: "services", icon: BadgeCheck, descriptionKey: "svc.nav.memberships.description", Element: Memberships, gridId: "pos-memberships" },
      { titleKey: "svc.nav.repairs", path: "/pos/repairs", feature: "services", icon: Wrench, descriptionKey: "svc.nav.repairs.description", Element: Repairs, gridId: "pos-repairs" },
      // P5 hotel and venues: reservation chart, rooms setup, guest register; events; ticketed events.
      { titleKey: "hotel.nav.chart", path: "/pos/hotel", feature: "hotel", icon: BedDouble, descriptionKey: "hotel.nav.chart.description", Element: HotelChart, gridId: "pos-hotel-unassigned" },
      { titleKey: "hotel.nav.setup", path: "/pos/hotel/setup", feature: "hotel", icon: HotelIcon, descriptionKey: "hotel.nav.setup.description", Element: HotelSetup },
      { titleKey: "hotel.nav.guests", path: "/pos/hotel/guests", feature: "hotel", icon: IdCard, descriptionKey: "hotel.nav.guests.description", Element: GuestRegister, gridId: "pos-guest-register" },
      { titleKey: "hotel.nav.events", path: "/pos/events", feature: "events", icon: PartyPopper, descriptionKey: "hotel.nav.events.description", Element: Events, gridId: "pos-events" },
      { titleKey: "hotel.nav.tickets", path: "/pos/tickets", feature: "events", icon: TicketCheck, descriptionKey: "hotel.nav.tickets.description", Element: TicketedEvents, gridId: "pos-ticketed-events" },
      // P7 specialist retail: pharmacy, fuel station, online channels, auto parts (items access).
      { titleKey: "spec.nav.pharmacy", path: "/pos/pharmacy", feature: "pharmacy", icon: PharmacyIcon, descriptionKey: "spec.nav.pharmacy.description", Element: Pharmacy, gridId: "pos-prescriptions" },
      { titleKey: "spec.nav.forecourt", path: "/pos/forecourt", feature: "forecourt", icon: FuelIcon, descriptionKey: "spec.nav.forecourt.description", Element: Forecourt },
      { titleKey: "spec.nav.online", path: "/pos/online", feature: "onlineSales", icon: OnlineIcon, descriptionKey: "spec.nav.online.description", Element: OnlineSales, gridId: "pos-channel-orders" },
      { titleKey: "spec.nav.parts", path: "/pos/parts", feature: "autoParts", icon: PartsIcon, descriptionKey: "spec.nav.parts.description", Element: PartsSearch, module: "items" },
    ],
  },
  {
    // docs/ERP_VERTICALS_PLAN.md (POS plan P8): projects — construction sites, buildings for sale and
    // rentals, all behind the Sales access area.
    id: "projects",
    labelKey: "vx.sidebar.projects",
    module: "sales",
    items: [
      { titleKey: "vx.nav.sites", path: "/construction", feature: "construction", icon: HardHat, descriptionKey: "vx.nav.sites.description", Element: ConstructionSites, gridId: "construction-sites" },
      { titleKey: "vx.nav.buildings", path: "/real-estate/buildings", feature: "realEstate", icon: BuildingIcon, descriptionKey: "vx.nav.buildings.description", Element: Buildings, gridId: "buildings" },
      { titleKey: "vx.nav.reservations", path: "/real-estate/reservations", feature: "realEstate", icon: CalendarCheck, descriptionKey: "vx.nav.reservations.description", Element: UnitReservations, gridId: "unit-reservations" },
      { titleKey: "vx.nav.contracts", path: "/real-estate/contracts", feature: "realEstate", icon: FileSignature, descriptionKey: "vx.nav.contracts.description", Element: SaleContracts, gridId: "unit-sale-contracts" },
      { titleKey: "vx.nav.leases", path: "/rentals/leases", feature: "rentals", icon: KeyRound, descriptionKey: "vx.nav.leases.description", Element: Leases, gridId: "leases" },
      { titleKey: "vx.nav.rentRun", path: "/rentals/rent-run", feature: "rentals", icon: Repeat, descriptionKey: "vx.nav.rentRun.description", Element: RentRun },
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

const navModuleByPath = new Map<string, NavModule>(
  navCategories.flatMap((category) =>
    category.items.flatMap((item) => {
      const module = item.module ?? category.module;
      return module ? [[item.path, module] as const] : [];
    }),
  ),
);

export function navModuleForPath(path: string): NavModule | undefined {
  return navModuleByPath.get(path);
}
