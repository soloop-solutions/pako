import { useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PosOrderSummaryResponse, SessionSummaryResponse } from "@pako/shared";
import { ChefHat, MonitorSmartphone, Printer } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { FormDialog } from "@/components/shared/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { cn } from "@/lib/utils";
import { AtkStatus, FiscalMode, PosOrderKind, PosSessionState, RegisterProfile, atkStatusKey, fiscalModeKey, posOrderKindKey, posSessionStateKey } from "@/lib/pos-enums";
import { printCoupon } from "@/lib/pos-print";
import { CouponReceipt } from "@/pages/pos/CouponReceipt";
import { usePosRegisters, usePosStores } from "@/hooks/usePos";
import { SessionReportView } from "@/pages/pos/Till";

const money = (v: number) => v.toFixed(2);

// docs/POS_PLAN.md §12: the back office's view of the tills — open one, see the sessions and
// every coupon issued, reprint one.
export function PosHome() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const registers = (usePosRegisters().data ?? []).filter((r) => r.isActive);
  const sessionsGrid = useDataGridUrlState("pos-sessions", 25);
  const ordersGrid = useDataGridUrlState("pos-orders", 50);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ["posSessions", activeCompanyId, sessionsGrid.page, sessionsGrid.pageSize],
    queryFn: () => apiClient.listPosSessions(activeCompanyId as string, undefined, sessionsGrid.page, sessionsGrid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });
  const orders = useQuery({
    queryKey: ["posOrders", activeCompanyId, ordersGrid.globalFilter, ordersGrid.page, ordersGrid.pageSize],
    queryFn: () => apiClient.listPosOrders(activeCompanyId as string, undefined, ordersGrid.globalFilter || undefined, ordersGrid.page, ordersGrid.pageSize),
    enabled: !!activeCompanyId,
    placeholderData: keepPreviousData,
  });

  const sessionColumns = useMemo<ColumnDef<SessionSummaryResponse>[]>(
    () => [
      { accessorKey: "registerCode", header: t("pos.register.code") },
      { accessorKey: "number", header: t("pos.session.number") },
      { id: "date", header: t("common.date"), cell: ({ row }) => intl.formatDate(row.original.businessDate) },
      { id: "opened", header: t("pos.session.openedAt"), cell: ({ row }) => intl.formatTime(row.original.openedAt) },
      {
        id: "state",
        header: t("common.type"),
        cell: ({ row }) => (
          <Badge variant={row.original.state === PosSessionState.Open ? "default" : "secondary"}>
            {t(`pos.session.state.${posSessionStateKey(row.original.state)}`)}
          </Badge>
        ),
      },
      {
        id: "net",
        header: t("pos.session.netSales"),
        cell: ({ row }) => <span className="block text-right tabular-nums">{money(row.original.netSales)}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const orderColumns = useMemo<ColumnDef<PosOrderSummaryResponse>[]>(
    () => [
      { accessorKey: "number", header: t("common.reference") },
      { id: "at", header: t("common.date"), cell: ({ row }) => `${intl.formatDate(row.original.orderedAt)} ${intl.formatTime(row.original.orderedAt)}` },
      { accessorKey: "registerCode", header: t("pos.register.code") },
      { id: "kind", header: t("common.type"), cell: ({ row }) => t(`pos.order.kind.${posOrderKindKey(row.original.kind)}`) },
      { accessorKey: "operatorName", header: t("coupon.operator") },
      { id: "coupon", header: t("coupon.id"), cell: ({ row }) => row.original.couponId ?? "—" },
      {
        id: "atk",
        header: "ATK",
        cell: ({ row }) =>
          row.original.atkStatus == null ? "—" : (
            <span className={cn(row.original.atkStatus === AtkStatus.Rejected && "text-destructive", row.original.atkStatus === AtkStatus.Pending && "text-amber-600")}>
              {t(`pos.atk.${atkStatusKey(row.original.atkStatus)}`)}
            </span>
          ),
      },
      {
        id: "total",
        header: t("common.total"),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {row.original.kind === PosOrderKind.Sale ? "" : "−"}
            {money(row.original.total)}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("nav.pos")}</CardTitle>
          <CardDescription>{t("nav.pos.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {registers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("pos.register.empty")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {registers.map((r) => (
                <div key={r.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.storeName} · {r.code}</p>
                    </div>
                    <Badge variant={r.fiscalMode === FiscalMode.Training ? "secondary" : "default"}>
                      {t(`pos.register.mode.${fiscalModeKey(r.fiscalMode)}`)}
                    </Badge>
                  </div>
                  <p className={cn("text-xs", r.openSessionId ? "text-emerald-600" : "text-muted-foreground")}>
                    {t(r.openSessionId ? "pos.register.sessionOpen" : "pos.register.sessionClosed")}
                  </p>
                  {canWrite("pos") && (
                    <Button size="sm" onClick={() => navigate(`/pos/till/${r.id}`)}>
                      <MonitorSmartphone className="size-4" />
                      {t("pos.register.open")}
                    </Button>
                  )}
                  {/* P3: a restaurant's kitchen display for this register's store. */}
                  {(r.profile === RegisterProfile.Cafe || r.profile === RegisterProfile.Restaurant) && (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/pos/kds?store=${r.storeId}`)}>
                      <ChefHat className="size-4" />
                      {t("rest.kds.open")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pos.sessions")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-sessions"
            columns={sessionColumns}
            data={sessions.data?.items ?? []}
            rowCount={sessions.data?.total ?? 0}
            isLoading={sessions.isPending}
            getRowId={(s) => s.id}
            onRowClick={(s) => setSessionId(s.id)}
            emptyMessage={t("pos.session.empty")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pos.orders")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId="pos-orders"
            columns={orderColumns}
            data={orders.data?.items ?? []}
            rowCount={orders.data?.total ?? 0}
            isLoading={orders.isPending}
            getRowId={(o) => o.id}
            getRowClassName={(o) => (o.state === 1 ? "line-through text-muted-foreground" : undefined)}
            onRowClick={(o) => setOrderId(o.id)}
            enableGlobalFilter
            globalFilterPlaceholder={t("till.return.lookup")}
            emptyMessage={t("pos.order.empty")}
          />
        </CardContent>
      </Card>

      {sessionId && <SessionDialog sessionId={sessionId} onClose={() => setSessionId(null)} />}
      {orderId && <OrderDialog orderId={orderId} onClose={() => setOrderId(null)} />}
    </div>
  );
}

function SessionDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const ref = useRef<HTMLDivElement>(null);
  const report = useQuery({
    queryKey: ["posReport", activeCompanyId, sessionId],
    queryFn: () => apiClient.getPosSessionReport(activeCompanyId as string, sessionId),
  });
  const r = report.data;
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t(r && r.state !== PosSessionState.Open ? "till.report.z" : "till.report.x")} size="sm">
      <div ref={ref}>{r ? <SessionReportView report={r} /> : <p className="text-muted-foreground">{t("common.loading")}</p>}</div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" onClick={() => printCoupon(ref.current)}>
          <Printer className="size-4" /> {t("common.print")}
        </Button>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </div>
    </FormDialog>
  );
}

function OrderDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const ref = useRef<HTMLDivElement>(null);
  const stores = usePosStores().data ?? [];
  const registers = usePosRegisters().data ?? [];
  const order = useQuery({
    queryKey: ["posOrder", activeCompanyId, orderId],
    queryFn: () => apiClient.getPosOrder(activeCompanyId as string, orderId),
  });
  // The issuer block: company name and numbers, from the register's bootstrap.
  const register = registers.find((r) => r.id === order.data?.registerId);
  const boot = useQuery({
    queryKey: ["posBootstrap", activeCompanyId, register?.id],
    queryFn: () => apiClient.getPosBootstrap(activeCompanyId as string, register!.id),
    enabled: !!register,
  });
  const store = stores.find((s) => s.id === register?.storeId);
  const o = order.data;
  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={o?.number ?? t("common.loading")} size="sm">
      {o && register && store && boot.data ? (
        <div className="max-h-[60vh] overflow-y-auto rounded border">
          <CouponReceipt
            ref={ref}
            order={o}
            store={store}
            register={register}
            issuer={{ companyName: boot.data.companyName, fiscalNumber: boot.data.fiscalNumber, vatNumber: boot.data.vatNumber }}
          />
        </div>
      ) : (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      )}
      {o?.fiscal?.atkError && <p className="mt-2 text-sm text-destructive">{o.fiscal.atkError}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" disabled={!o} onClick={() => printCoupon(ref.current)}>
          <Printer className="size-4" /> {t("till.print")}
        </Button>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </div>
    </FormDialog>
  );
}
