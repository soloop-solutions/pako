import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useDesktopSetup } from "@/pages/desktop/useDesktopSetup";

export function DesktopSetupGuard({ children }: { children: ReactNode }) {
  const { loading, needsSetup } = useDesktopSetup();
  const location = useLocation();
  if (loading) return <div className="flex-1" />;
  if (needsSetup && location.pathname !== "/first-run") return <Navigate to="/first-run" replace />;
  return <>{children}</>;
}
