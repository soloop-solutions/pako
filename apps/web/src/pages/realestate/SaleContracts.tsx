import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { SaleContractResponse } from "@pako/shared";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompany } from "@/context/CompanyContext";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useBuildings, vxKeys } from "@/hooks/useVerticals";
import { formatIsoDate } from "@/lib/sales-order-enums";
import { cn } from "@/lib/utils";
import { CONTRACT_STATES, ContractState } from "@/lib/verticals-enums";
import { ContractStateBadge, StateFilter } from "@/pages/verticals/shared";
import { amount, useT } from "@/pages/verticals/verticals-utils";

const GRID_ID = "unit-sale-contracts";

// docs/ERP_VERTICALS_PLAN.md §2 — sale contracts (kontrata shitjeje) of units: price, invoiced, paid,
// outstanding and overdue, as the API reports them.
export function SaleContracts() {
  const intl = useIntl();
  const t = useT();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const [state, setState] = useUrlParam("state", "", [`${GRID_ID}.page`]);
  const [buildingId, setBuildingId] = useUrlParam("building", "", [`${GRID_ID}.page`]);
  const buildings = useBuildings().data ?? [];
  const query = useQuery({
    queryKey: [...vxKeys.contracts(activeCompanyId), buildingId, state],
    queryFn: () => apiClient.listUnitSaleContracts(activeCompanyId as string, buildingId || undefined, state === "" ? undefined : Number(state)),
    enabled: !!activeCompanyId,
  });

  const columns = useMemo<ColumnDef<SaleContractResponse>[]>(
    () => [
      { accessorKey: "number", header: t("vx.number") },
      { accessorKey: "contractDate", header: t("common.date"), cell: ({ getValue }) => formatIsoDate(intl, getValue() as string) },
      { accessorKey: "buildingName", header: t("vx.building.name") },
      { accessorKey: "unitNumber", header: t("vx.unit.number") },
      { accessorKey: "buyerName", header: t("vx.contract.buyer") },
      { accessorKey: "kind", header: t("vx.contract.kind"), cell: ({ getValue }) => t(`vx.contractKind.${getValue() as number}`) },
      { accessorKey: "price", header: t("vx.contract.price"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "invoiced", header: t("vx.contract.invoiced"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "paid", header: t("vx.contract.paid"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      { accessorKey: "outstanding", header: t("vx.contract.outstanding"), meta: { numeric: true }, cell: ({ getValue }) => amount(getValue() as number) },
      {
        accessorKey: "overdue",
        header: t("vx.contract.overdue"),
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return v > 0 ? <Badge variant="destructive">{amount(v)}</Badge> : amount(v);
        },
      },
      { accessorKey: "state", header: t("vx.state"), cell: ({ getValue }) => <ContractStateBadge state={getValue() as number} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  if (!activeCompanyId) return <p className="text-muted-foreground">{t("common.selectCompanyFirst")}</p>;
  const rows = query.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("vx.nav.contracts")}</CardTitle>
        <CardDescription>{t("vx.nav.contracts.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <StateFilter value={state} onChange={setState} states={CONTRACT_STATES} labelPrefix="vx.contractState" label={t("vx.state")} />
          <div className="flex w-64 flex-col gap-1">
            <Label htmlFor="sc-filter-building">{t("vx.building.name")}</Label>
            <SearchableSelect id="sc-filter-building" value={buildingId} onChange={setBuildingId}
              placeholder={t("vx.building.all")} emptyOptionLabel={t("vx.building.all")} searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")} options={buildings.map((b) => ({ value: b.id, label: b.name }))} />
          </div>
        </div>
        <DataGrid
          gridId={GRID_ID}
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={query.isPending}
          getRowId={(r) => r.id}
          getRowClassName={(r) => cn(r.state === ContractState.Cancelled && "line-through text-muted-foreground")}
          onRowClick={(r) => navigate(`/real-estate/contracts/${r.id}`)}
          enableGlobalFilter
          globalFilterPlaceholder={t("vx.contract.search")}
          emptyMessage={t("vx.contract.empty")}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
      </CardContent>
    </Card>
  );
}
