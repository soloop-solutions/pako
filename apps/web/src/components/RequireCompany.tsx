import { Navigate, Outlet } from "react-router-dom";

import { useCompany } from "@/context/CompanyContext";

/**
 * Redirects to the company selection screen when the user has multiple companies
 * but none is currently active. Single-company users are auto-selected by CompanyContext.
 */
export function RequireCompany() {
  const { companies, activeCompanyId, loading } = useCompany();

  // Still loading companies — don't redirect yet
  if (loading) return null;

  // Multiple companies but none selected → pick one
  if (companies.length > 1 && !activeCompanyId) {
    return <Navigate to="/select-company" replace />;
  }

  return <Outlet />;
}
