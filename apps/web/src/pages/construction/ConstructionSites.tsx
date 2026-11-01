import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { SiteSummaryResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { DataGrid } from "@/components/data-grid/DataGrid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useConstructionSites } from "@/hooks/useVerticals";
import { cn } from "@/lib/utils";
import { SITE_STATES, SiteState } from "@/lib/verticals-enums";
import { SiteStateBadge, StateFilter } from "@/pages/verticals/shared";
import { amount, usePercent, useT } from "@/pages/verticals/verticals-utils";

const GRID_ID = "construction-sites";

// docs/ERP_VERTICALS_PLAN.md §1 — construction sites (kantieret): contract value, billed to date and
// the percentage of completion, all as the API reports them.
export function ConstructionSites() {
  const intl = useIntl();
  const t = useT();
  const percent = usePercent();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { canWrite } = useMyAccess();
  const [state, setState] = useUrlParam("state", "", [`${GRID_ID}.page`]);
  const query = useConstructionSites(state === "" ? undefined : Number(state));

  const columns = useMemo<ColumnDef<SiteSummaryResponse>[]>(
    () => [
      { accessorKey: "projectCode", header: t("vx.site.projectCode") },
      { accessorKey: "name", header: t("vx.site.name") },
      { accessorKey: "clientName", header: t("vx.site.client") },
      { accessorKey: "contractValue", header: t("vx.site.contractValue"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "billed", header: t("vx.site.billed"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "percentComplete", header: t("vx.site.percentComplete"), meta: { numeric: true }, cell: ({ getValue }) => percent(getValue() as number) },
      { accessorKey: "state", header: t("vx.state"), cell: ({ getValue }) => <SiteStateBadge state={getValue() as number} /> },
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
          <CardTitle>{t("vx.nav.sites")}</CardTitle>
          <CardDescription>{t("vx.nav.sites.description")}</CardDescription>
        </div>
        {canWrite("sales") && (
          <Button size="sm" onClick={() => navigate("/construction/new")}>
            <Plus className="size-4" />
            {t("vx.site.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <StateFilter value={state} onChange={setState} states={SITE_STATES} labelPrefix="vx.siteState" label={t("vx.state")} />
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => cn((r.state === SiteState.Tender || r.state === SiteState.Closed) && "text-muted-foreground")}
          onRowClick={(r) => navigate(`/construction/${r.id}`)}
          enableGlobalFilter
          globalFilterPlaceholder={t("vx.site.search")}
          emptyMessage={t("vx.site.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}
