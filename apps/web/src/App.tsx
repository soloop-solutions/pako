import { AcceptInvitation } from "@/pages/AcceptInvitation";
import { ForgotPassword, ResetPassword } from "@/pages/PasswordReset";
import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireCompany } from "@/components/RequireCompany";
import { navItems } from "@/config/nav";
import { AuthProvider } from "@/context/AuthContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { BillDetail } from "@/pages/bills/BillDetail";
import { ComingSoon } from "@/pages/ComingSoon";
import { CompanySelect } from "@/pages/CompanySelect";
import { InvoiceDetail } from "@/pages/invoicing/InvoiceDetail";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { PayrollRunDetail } from "@/pages/payroll/PayrollRunDetail";
import { EmployeeDetail } from "@/pages/hr/EmployeeDetail";
import { StockDocumentDetail } from "@/pages/inventory/StockDocumentDetail";
import { PriceChangeDetail } from "@/pages/inventory/PriceChangeDetail";
import { PurchaseOrderDetail } from "@/pages/bills/PurchaseOrderDetail";
import { RequestAccount } from "@/pages/RequestAccount";
import { PlatformAdmin } from "@/pages/platform/PlatformAdmin";
import { Till } from "@/pages/pos/Till";
import { Kds } from "@/pages/pos/Kds";
import { PublicMenu } from "@/pages/pos/PublicMenu";
import { PublicBooking } from "@/pages/pos/PublicBooking";
import { TicketScanner } from "@/pages/pos/events/TicketScanner";
// docs/POS_PLAN.md P6: a sales order (new or existing).
import { SalesOrderDetail } from "@/pages/sales/SalesOrderDetail";
// docs/ERP_VERTICALS_PLAN.md (POS plan P8): a construction site, a building, a sale contract, a lease.
import { SiteDetail } from "@/pages/construction/SiteDetail";
import { BuildingDetail } from "@/pages/realestate/BuildingDetail";
import { SaleContractDetail } from "@/pages/realestate/SaleContractDetail";
import { LeaseDetail } from "@/pages/rentals/LeaseDetail";

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
                  <Route path="/pos/till/:registerId" element={<Till />} />
                  {/* P3: the kitchen display, full screen too (?store=…&center=…). */}
                  <Route path="/pos/kds" element={<Kds />} />
                  {/* P5: the door scanner for ticketed events, full screen (?event=…). */}
                  <Route path="/pos/scan" element={<TicketScanner />} />
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<Landing />} />
                    {navItems.map(({ path, titleKey, descriptionKey, Element }) => (
                      <Route
                        key={path}
                        path={path}
                        element={Element ? <Element /> : <ComingSoon titleKey={titleKey} descriptionKey={descriptionKey} />}
                      />
                    ))}
                    <Route path="/invoicing/:id" element={<InstanceRoute Component={InvoiceDetail} />} />
                    <Route path="/sales-returns/:id" element={<InstanceRoute Component={InvoiceDetail} />} />
                    <Route path="/bills/:id" element={<InstanceRoute Component={BillDetail} />} />
                    <Route path="/purchase-returns/:id" element={<InstanceRoute Component={BillDetail} />} />
                    <Route path="/payroll/:id" element={<InstanceRoute Component={PayrollRunDetail} />} />
                    <Route path="/employees/:id" element={<InstanceRoute Component={EmployeeDetail} />} />
                    <Route path="/stock-documents/:id" element={<InstanceRoute Component={StockDocumentDetail} />} />
                    <Route path="/price-changes/:id" element={<InstanceRoute Component={PriceChangeDetail} />} />
                    <Route path="/purchase-orders/:id" element={<InstanceRoute Component={PurchaseOrderDetail} />} />
                    <Route path="/sales-orders/:id" element={<InstanceRoute Component={SalesOrderDetail} />} />
                    <Route path="/construction/:id" element={<InstanceRoute Component={SiteDetail} />} />
                    <Route path="/real-estate/buildings/:id" element={<InstanceRoute Component={BuildingDetail} />} />
                    <Route path="/real-estate/contracts/:id" element={<InstanceRoute Component={SaleContractDetail} />} />
                    <Route path="/rentals/leases/:id" element={<InstanceRoute Component={LeaseDetail} />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </CompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
