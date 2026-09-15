import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAuth } from "@/components/RequireAuth";
import { navItems } from "@/config/nav";
import { AuthProvider } from "@/context/AuthContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { BillDetail } from "@/pages/bills/BillDetail";
import { ComingSoon } from "@/pages/ComingSoon";
import { InvoiceDetail } from "@/pages/invoicing/InvoiceDetail";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { PayrollRunDetail } from "@/pages/payroll/PayrollRunDetail";
import { Register } from "@/pages/Register";

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
              <Route path="/register" element={<Register />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Landing />} />
                  {navItems.map(({ path, titleKey, descriptionKey, Element }) => (
                    <Route
                      key={path}
                      path={path}
                      element={Element ? <Element /> : <ComingSoon titleKey={titleKey} descriptionKey={descriptionKey} />}
                    />
                  ))}
                  <Route path="/invoicing/:id" element={<InvoiceDetail />} />
                  <Route path="/bills/:id" element={<BillDetail />} />
                  <Route path="/payroll/:id" element={<PayrollRunDetail />} />
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
