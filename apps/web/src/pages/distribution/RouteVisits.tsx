import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { RouteVisitResponse } from "@pako/shared";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyMembers } from "@/hooks/usePosServices";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatAmount } from "@/lib/payroll-enums";
import { RouteVisitOutcome, isoToday } from "@/lib/sales-order-enums";

const GRID_ID = "route-visits";

// docs/POS_PLAN.md P6 — the field team's visits on a day, with the KPIs the API computes: strike
// rate (visits that ended in an order or sale), drop size (order value per such visit), collected.
export function RouteVisits() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { activeCompanyId } = useCompany();
  const members = useCompanyMembers().data ?? [];
  const [date, setDate] = useUrlParam("date", isoToday(), [`${GRID_ID}.page`]);
  const [userId, setUserId] = useUrlParam("member", "", [`${GRID_ID}.page`]);
  const query = useQuery({
    queryKey: ["routeVisits", activeCompanyId, date, userId],
    queryFn: () => apiClient.listRouteVisits(activeCompanyId as string, date || undefined, userId || undefined),
    enabled: !!activeCompanyId,
  });
  const summary = query.data;
  const visits = summary?.items ?? [];

  const columns = useMemo<ColumnDef<RouteVisitResponse>[]>(
    () => [
      {
        accessorKey: "checkInAt",
        header: t("dist.visit.checkInAt"),
        cell: ({ row }) => (
          <span className="tnum">
            {intl.formatTime(new Date(row.original.checkInAt), { timeStyle: "short" })}
            {row.original.checkOutAt && ` – ${intl.formatTime(new Date(row.original.checkOutAt), { timeStyle: "short" })}`}
          </span>
        ),
      },
      { accessorKey: "partnerName", header: t("so.col.customer") },
      { id: "member", header: t("dist.route.salesperson"), accessorFn: (r) => members.find((m) => m.userId === r.userId)?.email ?? r.userId },
      {
        accessorKey: "outcome",
        header: t("dist.visit.outcome"),
        cell: ({ getValue }) => {
          const outcome = getValue() as number;
          const variant = outcome === RouteVisitOutcome.Order || outcome === RouteVisitOutcome.Sale ? "success" : outcome === RouteVisitOutcome.Open ? "draft" : "outline";
          return <Badge variant={variant}>{t(`dist.visit.outcome.${outcome}`)}</Badge>;
        },
      },
      { accessorKey: "collected", header: t("dist.visit.collected"), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      {
        id: "orders",
        header: t("dist.visit.orders"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.salesOrderIds.length === 0
              ? "—"
              : row.original.salesOrderIds.map((orderId, i) => (
                  <Link key={orderId} className="text-primary underline-offset-2 hover:underline" to={`/sales-orders/${orderId}`}>
                    {intl.formatMessage({ id: "dist.visit.orderN" }, { n: i + 1 })}
                  </Link>
                ))}
          </span>
        ),
      },
      { accessorKey: "notes", header: t("dist.visit.notes"), cell: ({ getValue }) => (getValue() as string | undefined) ?? "" },
      {
        id: "map",
        header: t("dist.visit.position"),
        enableSorting: false,
        cell: ({ row }) => (row.original.latitude != null && row.original.longitude != null ? (
          <a className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer"
            href={`https://www.google.com/maps?q=${row.original.latitude},${row.original.longitude}`}>
            {t("dist.visit.map")}
            {row.original.accuracyMeters != null && ` (±${intl.formatNumber(Math.round(row.original.accuracyMeters))} m)`}
          </a>
        ) : <span className="text-muted-foreground">{t("dist.visit.noPosition")}</span>),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, members],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("nav.routeVisits")}</h2>
          <p className="text-sm text-muted-foreground">{t("nav.routeVisits.description")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="visits-date">{t("dist.date")}</Label>
            <Input id="visits-date" type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex w-60 flex-col gap-1">
            <Label htmlFor="visits-member">{t("dist.route.salesperson")}</Label>
            <SearchableSelect id="visits-member" value={userId} onChange={setUserId} placeholder={t("dist.visit.everyone")}
              emptyOptionLabel={t("dist.visit.everyone")} searchPlaceholder={t("common.search")} noResultsText={t("common.noResults")}
              options={members.map((m) => ({ value: m.userId, label: m.email }))} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={t("dist.kpi.visits")} value={summary ? intl.formatNumber(summary.visits) : "—"} />
        <Kpi label={t("dist.kpi.withOrder")} value={summary ? intl.formatNumber(summary.withOrder) : "—"} />
        <Kpi label={t("dist.kpi.strikeRate")} value={summary ? intl.formatNumber(summary.strikeRate, { style: "percent", maximumFractionDigits: 1 }) : "—"} />
        <Kpi label={t("dist.kpi.dropSize")} value={summary ? formatAmount(summary.dropSize) : "—"} hint={summary ? `${t("dist.kpi.orderValue")}: ${formatAmount(summary.orderValue)}` : undefined} />
        <Kpi label={t("dist.kpi.collected")} value={summary ? formatAmount(summary.collected) : "—"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("dist.visit.list")}</CardTitle>
          <CardDescription>{t("dist.visit.listHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={visits}
            rowCount={visits.length}
            isLoading={query.isPending}
            getRowId={(r) => r.id}
            enableGlobalFilter
            emptyMessage={t("dist.visit.empty")}
            exportFileName="visits"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tnum">{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground tnum">{hint}</span>}
    </div>
  );
}
