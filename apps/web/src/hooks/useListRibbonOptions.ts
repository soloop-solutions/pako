import { useMemo } from "react";

import { useCompanyMembers } from "@/hooks/usePosServices";
import { useWarehouses } from "@/hooks/useStock";

// The warehouse and "created by" choices every document ribbon offers (client request 2026-11-24).
export function useListRibbonOptions() {
  const warehouses = useWarehouses();
  const members = useCompanyMembers();
  return useMemo(
    () => ({
      warehouses: (warehouses.data ?? []).filter((w) => w.isActive).map((w) => ({ id: w.id, name: w.name })),
      users: (members.data ?? []).map((m) => ({ id: m.userId, name: m.email })),
    }),
    [warehouses.data, members.data],
  );
}
