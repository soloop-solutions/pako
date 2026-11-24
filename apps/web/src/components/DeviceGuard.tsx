import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useCompany } from "@/context/CompanyContext";
import { isDevicePath, useMyPosDevice } from "@/lib/posDevice";

// docs/POS_TILL_ACCESS.md §7: a till device stays on the till and kitchen screens. It works in its
// own company only, and any other page — typed, linked, or the till's "Leave" — leads back to the
// device home. (The server refuses everything else anyway; this keeps the screen honest.)
export function DeviceGuard() {
  const { device, isPending } = useMyPosDevice();
  const { activeCompanyId, setActiveCompanyId } = useCompany();
  const location = useLocation();

  useEffect(() => {
    if (device && activeCompanyId !== device.companyId) setActiveCompanyId(device.companyId);
  }, [device, activeCompanyId, setActiveCompanyId]);

  if (isPending) return null;
  if (!device) return <Outlet />;
  if (activeCompanyId !== device.companyId) return null;
  if (!isDevicePath(location.pathname)) {
    // Opening the app ("/") reopens the last screen; leaving the till stays on the device home.
    return <Navigate to="/device" replace state={{ reopen: location.pathname === "/" }} />;
  }
  return <Outlet />;
}
