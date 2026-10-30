import { Navigate, Outlet } from "react-router-dom";

import { useCompany } from "@/context/CompanyContext";

/**
 * The app always runs inside one company, chosen in the lobby (/select-company). Without an active
 * company — after signing in, or after leaving a company — the user is sent back to the lobby.
 * Nothing is picked automatically, even for a single company.
 */
export function RequireCompany() {
  const { activeCompanyId, loading, loaded } = useCompany();

  // Still loading companies — or a reload restored the active company before the list arrived —
  // render nothing rather than a page that briefly has no company.
  if (loading || (activeCompanyId && !loaded)) return null;

  if (!activeCompanyId) {
    return <Navigate to="/select-company" replace />;
  }

  return <Outlet />;
}
