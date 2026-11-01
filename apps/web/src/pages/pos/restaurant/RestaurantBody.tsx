import { useState, type ReactNode } from "react";
import type { PosBootstrapResponse, PosCatalogItemResponse } from "@pako/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, FileBarChart, Lock, ShoppingCart } from "lucide-react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";

import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/context/CompanyContext";
import { usePosHub } from "@/lib/pos-hub";
import { CashMovementDialog, CloseSessionDialog, ReportDialog } from "@/pages/pos/Till";
import { FloorPlanView } from "@/pages/pos/restaurant/FloorPlan";
import { TabView } from "@/pages/pos/restaurant/TabView";

// docs/POS_PLAN.md P3: a café or restaurant till. It opens on the floor plan; a tapped table opens
// its tab; a counter sale (the retail till) is one button away. The open tab, the floor and the
// counter view live in the URL, so a reload lands where the waiter was. The floor and the open tab
// refresh live over the store's SignalR channel, with slow polling as a fallback.
export function RestaurantBody({ boot, sessionId, catalog, counterSale }: {
  boot: PosBootstrapResponse;
  sessionId: string;
  catalog: PosCatalogItemResponse[];
  counterSale: (onBack: () => void) => ReactNode;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;
  const queryClient = useQueryClient();
  const storeId = boot.store.id;
  const [params, setParams] = useSearchParams();
  const tabId = params.get("tab");
  const counter = params.get("view") === "counter";
  const [dialog, setDialog] = useState<"cash" | "x" | "close" | null>(null);

  const plan = useQuery({
    queryKey: ["posFloorPlan", companyId, storeId],
    queryFn: () => apiClient.getPosFloorPlan(companyId, storeId),
    refetchInterval: 30_000,
  });
  const menu = useQuery({
    queryKey: ["posMenu", companyId],
    queryFn: () => apiClient.getPosMenu(companyId),
    staleTime: 5 * 60_000,
  });

  usePosHub(companyId, storeId, {
    tabs: () => {
      void queryClient.invalidateQueries({ queryKey: ["posFloorPlan", companyId] });
      void queryClient.invalidateQueries({ queryKey: ["posOpenTabs", companyId] });
      if (tabId) void queryClient.invalidateQueries({ queryKey: ["posTab", companyId, tabId] });
    },
  });

  function go(next: { tab?: string | null; view?: string | null; floor?: string | null }) {
    setParams((p) => {
      const q = new URLSearchParams(p);
      for (const [k, v] of Object.entries(next)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      return q;
    });
  }

  if (counter) return <>{counterSale(() => go({ view: null }))}</>;

  if (tabId)
    return (
      <TabView
        key={tabId}
        boot={boot}
        sessionId={sessionId}
        tabId={tabId}
        catalog={catalog}
        menu={menu.data}
        plan={plan.data}
        onBack={() => go({ tab: null })}
      />
    );

  return (
    <>
      <FloorPlanView
        storeId={storeId}
        plan={plan.data}
        floorId={params.get("floor")}
        onFloor={(floor) => go({ floor })}
        onOpenTab={(id) => go({ tab: id })}
        toolbar={
          <>
            <Button variant="outline" onClick={() => go({ view: "counter" })}>
              <ShoppingCart className="size-4" /> {t("rest.counterSale")}
            </Button>
            <Button variant="outline" onClick={() => setDialog("cash")}>
              <Banknote className="size-4" /> {t("till.actions.cash")}
            </Button>
            <Button variant="outline" onClick={() => setDialog("x")}>
              <FileBarChart className="size-4" /> {t("till.actions.x")}
            </Button>
            <Button variant="outline" onClick={() => setDialog("close")}>
              <Lock className="size-4" /> {t("till.actions.close")}
            </Button>
          </>
        }
      />
      {dialog === "cash" && <CashMovementDialog sessionId={sessionId} onClose={() => setDialog(null)} />}
      {dialog === "x" && <ReportDialog sessionId={sessionId} onClose={() => setDialog(null)} />}
      {dialog === "close" && <CloseSessionDialog boot={boot} sessionId={sessionId} onClose={() => setDialog(null)} />}
    </>
  );
}
