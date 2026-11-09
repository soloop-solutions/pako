import { lazy, Suspense, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireCompany } from "@/components/RequireCompany";
import { FeatureGate } from "@/components/FeatureGate";
import { navItems, navModuleForPath } from "@/config/nav";
import { ModuleGate } from "@/components/ModuleGate";
import { AuthProvider } from "@/context/AuthContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { ComingSoon } from "@/pages/ComingSoon";
import { CompanySelect } from "@/pages/CompanySelect";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { RequestAccount } from "@/pages/RequestAccount";

// Lazy-loaded page components for code splitting.
const AcceptInvitation = lazy(() => import("@/pages/AcceptInvitation").then(m => ({ default: m.AcceptInvitation })));
const ForgotPassword = lazy(() => import("@/pages/PasswordReset").then(m => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("@/pages/PasswordReset").then(m => ({ default: m.ResetPassword })));
const BillDetail = lazy(() => import("@/pages/bills/BillDetail").then(m => ({ default: m.BillDetail })));
const InvoiceDetail = lazy(() => import("@/pages/invoicing/InvoiceDetail").then(m => ({ default: m.InvoiceDetail })));
const PayrollRunDetail = lazy(() => import("@/pages/payroll/PayrollRunDetail").then(m => ({ default: m.PayrollRunDetail })));
const EmployeeDetail = lazy(() => import("@/pages/hr/EmployeeDetail").then(m => ({ default: m.EmployeeDetail })));
const StockDocumentDetail = lazy(() => import("@/pages/inventory/StockDocumentDetail").then(m => ({ default: m.StockDocumentDetail })));
const PriceChangeDetail = lazy(() => import("@/pages/inventory/PriceChangeDetail").then(m => ({ default: m.PriceChangeDetail })));
const PurchaseOrderDetail = lazy(() => import("@/pages/bills/PurchaseOrderDetail").then(m => ({ default: m.PurchaseOrderDetail })));
const PlatformAdmin = lazy(() => import("@/pages/platform/PlatformAdmin").then(m => ({ default: m.PlatformAdmin })));
const Till = lazy(() => import("@/pages/pos/Till").then(m => ({ default: m.Till })));
const Kds = lazy(() => import("@/pages/pos/Kds").then(m => ({ default: m.Kds })));
const PublicMenu = lazy(() => import("@/pages/pos/PublicMenu").then(m => ({ default: m.PublicMenu })));
const PublicBooking = lazy(() => import("@/pages/pos/PublicBooking").then(m => ({ default: m.PublicBooking })));
const TicketScanner = lazy(() => import("@/pages/pos/events/TicketScanner").then(m => ({ default: m.TicketScanner })));
// docs/POS_PLAN.md P6: a sales order (new or existing).
const SalesOrderDetail = lazy(() => import("@/pages/sales/SalesOrderDetail").then(m => ({ default: m.SalesOrderDetail })));
// docs/ERP_VERTICALS_PLAN.md (POS plan P8): a construction site, a building, a sale contract, a lease.
const SiteDetail = lazy(() => import("@/pages/construction/SiteDetail").then(m => ({ default: m.SiteDetail })));
const BuildingDetail = lazy(() => import("@/pages/realestate/BuildingDetail").then(m => ({ default: m.BuildingDetail })));
const SaleContractDetail = lazy(() => import("@/pages/realestate/SaleContractDetail").then(m => ({ default: m.SaleContractDetail })));
const LeaseDetail = lazy(() => import("@/pages/rentals/LeaseDetail").then(m => ({ default: m.LeaseDetail })));

// react-router reuses the same component instance across `:id` param changes — it does not
// remount just because the URL param did. That's wrong for an instance-tab route: switching
// between two already-open document tabs must not leak one record's local state (editing mode,
// dirty flag, in-flight data) into the other. Keying on `id` forces a remount per record.
function InstanceRoute({ Component }: { Component: ComponentType }) {
  const { id } = useParams();
  return <Component key={id} />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CompanyProvider>
          <BrowserRouter>
            <Suspense fallback={<div className="flex-1" />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                {/* No self-registration (docs/PLATFORM_ADMIN.md): people request an account. */}
                <Route path="/register" element={<Navigate to="/request-account" replace />} />
                <Route path="/request-account" element={<RequestAccount />} />
                <Route path="/accept-invite" element={<AcceptInvitation />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                {/* docs/POS_PLAN.md P3: the QR menu on a table — anonymous, outside auth and the app shell. */}
                <Route path="/menu/:token" element={<PublicMenu />} />
                {/* P4: online booking through a store's link — anonymous too. */}
                <Route path="/book/:token" element={<PublicBooking />} />
                <Route element={<RequireAuth />}>
                  <Route path="/select-company" element={<CompanySelect />} />
                  <Route path="/platform" element={<PlatformAdmin />} />
                  <Route element={<RequireCompany />}>
                    {/* docs/POS_PLAN.md: the till is full screen, outside the app shell. */}
                    <Route path="/pos/till/:registerId" element={<ModuleGate module="pos"><Till /></ModuleGate>} />
                    {/* P3: the kitchen display, full screen too (?store=…&center=…). */}
                    <Route path="/pos/kds" element={<ModuleGate module="pos"><FeatureGate feature="hospitality" fullScreen><Kds /></FeatureGate></ModuleGate>} />
                    {/* P5: the door scanner for ticketed events, full screen (?event=…). */}
                    <Route path="/pos/scan" element={<ModuleGate module="pos"><FeatureGate feature="events" fullScreen><TicketScanner /></FeatureGate></ModuleGate>} />
                    <Route element={<AppLayout />}>
                      <Route path="/" element={<Landing />} />
                      {/* Business types: a page of a pack the company doesn't use says so (FeatureGate). */}
                      {navItems.map(({ path, titleKey, descriptionKey, Element, feature }) => (
                        <Route
                          key={path}
                          path={path}
                          element={
                            <ModuleGate module={navModuleForPath(path)}>
                              <FeatureGate feature={feature}>
                                {Element ? <Element /> : <ComingSoon titleKey={titleKey} descriptionKey={descriptionKey} />}
                              </FeatureGate>
                            </ModuleGate>
                          }
                        />
                      ))}
                      <Route path="/invoicing/:id" element={<ModuleGate module="sales"><InstanceRoute Component={InvoiceDetail} /></ModuleGate>} />
                      <Route path="/sales-returns/:id" element={<ModuleGate module="sales"><InstanceRoute Component={InvoiceDetail} /></ModuleGate>} />
                      <Route path="/bills/:id" element={<ModuleGate module="purchases"><InstanceRoute Component={BillDetail} /></ModuleGate>} />
                      <Route path="/purchase-returns/:id" element={<ModuleGate module="purchases"><InstanceRoute Component={BillDetail} /></ModuleGate>} />
                      <Route path="/payroll/:id" element={<ModuleGate module="payroll"><InstanceRoute Component={PayrollRunDetail} /></ModuleGate>} />
                      <Route path="/employees/:id" element={<ModuleGate module="hr"><InstanceRoute Component={EmployeeDetail} /></ModuleGate>} />
                      <Route path="/stock-documents/:id" element={<ModuleGate module="inventory"><InstanceRoute Component={StockDocumentDetail} /></ModuleGate>} />
                      <Route path="/price-changes/:id" element={<ModuleGate module="items"><InstanceRoute Component={PriceChangeDetail} /></ModuleGate>} />
                      <Route path="/purchase-orders/:id" element={<ModuleGate module="purchases"><InstanceRoute Component={PurchaseOrderDetail} /></ModuleGate>} />
                      <Route path="/sales-orders/:id" element={<ModuleGate module="sales"><InstanceRoute Component={SalesOrderDetail} /></ModuleGate>} />
                      <Route path="/construction/:id" element={<ModuleGate module="sales"><FeatureGate feature="construction"><InstanceRoute Component={SiteDetail} /></FeatureGate></ModuleGate>} />
                      <Route path="/real-estate/buildings/:id" element={<ModuleGate module="sales"><FeatureGate feature="realEstate"><InstanceRoute Component={BuildingDetail} /></FeatureGate></ModuleGate>} />
                      <Route path="/real-estate/contracts/:id" element={<ModuleGate module="sales"><FeatureGate feature="realEstate"><InstanceRoute Component={SaleContractDetail} /></FeatureGate></ModuleGate>} />
                      <Route path="/rentals/leases/:id" element={<ModuleGate module="sales"><FeatureGate feature="rentals"><InstanceRoute Component={LeaseDetail} /></FeatureGate></ModuleGate>} />
                    </Route>
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </CompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
