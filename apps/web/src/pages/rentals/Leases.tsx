import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { LeaseResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompany } from "@/context/CompanyContext";
import { usePartners } from "@/hooks/useDistribution";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate } from "@/lib/sales-order-enums";
import { cn } from "@/lib/utils";
import { LEASE_STATES, LeaseState } from "@/lib/verticals-enums";
import { LeaseStateBadge, StateFilter } from "@/pages/verticals/shared";
import { amount, formatMonth, useT } from "@/pages/verticals/verticals-utils";

const GRID_ID = "leases";

// docs/ERP_VERTICALS_PLAN.md §3 — leases (kontrata qiraje): tenant, property, monthly rent, the last
// month invoiced and the arrears, as the API reports them.
export function Leases() {
  const intl = useIntl();
  const t = useT();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const [state, setState] = useUrlParam("state", "", [`${GRID_ID}.page`]);
  const [tenantId, setTenantId] = useUrlParam("tenant", "", [`${GRID_ID}.page`]);
  const tenants = (usePartners().data ?? []).filter((p) => p.isCustomer);
  const query = useQuery({
    queryKey: [...vxKeys.leases(activeCompanyId), state, tenantId],
    queryFn: () => apiClient.listLeases(activeCompanyId as string, state === "" ? undefined : Number(state), tenantId || undefined),
    enabled: !!activeCompanyId,
  });

  const columns = useMemo<ColumnDef<LeaseResponse>[]>(
    () => [
      { accessorKey: "number", header: t("vx.number") },
      { accessorKey: "tenantName", header: t("vx.lease.tenant") },
      { id: "property", header: t("vx.lease.property"), accessorFn: (r) => r.unitLabel ?? r.property ?? "—" },
      { accessorKey: "startDate", header: t("vx.lease.startDate"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { accessorKey: "endDate", header: t("vx.lease.endDate"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string | undefined) },
      { accessorKey: "rent", header: t("vx.lease.rent"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "lastInvoicedPeriod", header: t("vx.lease.lastInvoiced"), cell: ({ getValue }) => formatMonth(intl, getValue() as string | undefined) },
      {
        accessorKey: "arrears",
        header: t("vx.lease.arrears"),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return <span className={cn(v > 0 && "font-semibold text-destructive")} data-testid="lease-arrears">{amount(v)}</span>;
        },
      },
      { accessorKey: "state", header: t("vx.state"), cell: ({ getValue }) => <LeaseStateBadge state={getValue() as number} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const rows = query.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("vx.nav.leases")}</CardTitle>
          <CardDescription>{t("vx.nav.leases.description")}</CardDescription>
        </div>
        {canWrite("sales") && (
          <Button size="sm" onClick={() => navigate("/rentals/leases/new")}><Plus className="size-4" />{t("vx.lease.new")}</Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <StateFilter value={state} onChange={setState} states={LEASE_STATES} labelPrefix="vx.leaseState" label={t("vx.state")} />
          <div className="flex w-64 flex-col gap-1">
            <Label htmlFor="lease-filter-tenant">{t("vx.lease.tenant")}</Label>
            <SearchableSelect id="lease-filter-tenant" value={tenantId} onChange={setTenantId}
              placeholder={t("vx.lease.allTenants")} emptyOptionLabel={t("vx.lease.allTenants")} searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")} options={tenants.map((p) => ({ value: p.id, label: p.name }))} />
          </div>
        </div>
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => cn(r.state !== LeaseState.Active && "text-muted-foreground")}
          onRowClick={(r) => navigate(`/rentals/leases/${r.id}`)}
          enableGlobalFilter
          globalFilterPlaceholder={t("vx.lease.search")}
          emptyMessage={t("vx.lease.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}
