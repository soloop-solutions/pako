import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { FixedAssetResponse } from "@pako/shared";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useMyAccess } from "@/hooks/useMyAccess";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatDisplayDate } from "@/lib/dates";
import { formatAmount } from "@/lib/payroll-enums";
import { cn } from "@/lib/utils";
import { AssetDialog } from "@/pages/assets/AssetDialog";

const GRID_ID = "fixedAssets";
const SORT_FIELDS: Record<string, string> = { code: "code", name: "name", inServiceDate: "inService", cost: "cost" };

function money(id: keyof FixedAssetResponse & string, header: string): ColumnDef<FixedAssetResponse> {
  return { accessorKey: id, header, meta: { numeric: true }, enableColumnFilter: false, cell: ({ getValue }) => formatAmount(getValue() as number) };
}

export function AssetStatusBadge({ asset }: { asset: FixedAssetResponse }) {
  const intl = useIntl();
  if (asset.status === "Disposed") return <Badge variant="secondary" className="line-through">{intl.formatMessage({ id: "assets.status.disposed" })}</Badge>;
  if (asset.isFullyDepreciated) return <Badge variant="outline">{intl.formatMessage({ id: "assets.status.fullyDepreciated" })}</Badge>;
  if (!asset.isDepreciable) return <Badge variant="outline">{intl.formatMessage({ id: "assets.status.notDepreciated" })}</Badge>;
  return <Badge variant="default">{intl.formatMessage({ id: "assets.status.active" })}</Badge>;
}

// The asset register: server-paged, filters in the URL. Every figure (accumulated, book value,
// monthly amount) is the API's.
export function AssetRegisterTab({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { canWrite } = useMyAccess();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const [status, setStatus] = useUrlParam("assetStatus", "", [`${GRID_ID}.page`]);
  const [categoryId, setCategoryId] = useUrlParam("assetCategory", "", [`${GRID_ID}.page`]);
  const [openId, setOpenId] = useState<string | "new" | null>(null);

  const sort = grid.sort && SORT_FIELDS[grid.sort.id] ? `${grid.sort.desc ? "-" : ""}${SORT_FIELDS[grid.sort.id]}` : undefined;
  const query = useQuery({
    queryKey: ["fixedAssets", companyId, status, categoryId, grid.globalFilter, grid.page, grid.pageSize, sort],
    queryFn: () => apiClient.listFixedAssets(companyId, grid.page, grid.pageSize, grid.globalFilter || undefined, sort, status || undefined, categoryId || undefined),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: ["assetCategories", companyId], queryFn: () => apiClient.listAssetCategories(companyId) }).data ?? [];

  const columns = useMemo<ColumnDef<FixedAssetResponse>[]>(
    () => [
      { accessorKey: "code", header: t("assets.col.code") },
      { accessorKey: "name", header: t("assets.col.name") },
      { accessorKey: "categoryName", header: t("assets.col.category"), enableSorting: false },
      { accessorKey: "inServiceDate", header: t("assets.col.inService"), enableColumnFilter: false, cell: ({ getValue }) => formatDisplayDate(getValue() as string) },
      money("cost", t("assets.col.cost")),
      money("accumulatedDepreciation", t("assets.col.accumulated")),
      money("bookValue", t("assets.col.bookValue")),
      money("monthlyDepreciation", t("assets.col.monthly")),
      { id: "status", accessorFn: (a) => a.status, header: t("assets.col.status"), enableSorting: false, enableColumnFilter: false, cell: ({ row }) => <AssetStatusBadge asset={row.original} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  const loadError = query.isError ? getApiErrorMessage(query.error, t("assets.loadError")) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex w-fit rounded-md border bg-card p-0.5" role="radiogroup" aria-label={t("assets.col.status")}>
            {["", "active", "disposed"].map((value) => (
              <button
                key={value || "all"}
                type="button"
                role="radio"
                aria-checked={status === value}
                onClick={() => setStatus(value)}
                className={cn(
                  "h-7 rounded-[5px] px-3 text-[12.5px] font-medium",
                  status === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {t(value === "" ? "assets.filter.all" : `assets.status.${value}`)}
              </button>
            ))}
          </div>
          <div className="flex w-64 flex-col gap-1">
            <Label htmlFor="asset-filter-category">{t("assets.col.category")}</Label>
            <SearchableSelect
              id="asset-filter-category"
              value={categoryId}
              onChange={setCategoryId}
              placeholder={t("assets.filter.allCategories")}
              emptyOptionLabel={t("assets.filter.allCategories")}
              searchPlaceholder={t("common.search")}
              noResultsText={t("common.noResults")}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        </div>
        {canWrite("accounting") && (
          <Button size="sm" onClick={() => setOpenId("new")}>
            <Plus className="size-4" />
            {t("assets.new")}
          </Button>
        )}
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={query.data?.items ?? []}
        rowCount={query.data?.total ?? 0}
        isLoading={query.isPending}
        getRowId={(a) => a.id}
        getRowClassName={(a) => (a.status === "Disposed" ? "text-muted-foreground line-through" : undefined)}
        onRowClick={(a) => setOpenId(a.id)}
        enableGlobalFilter
        globalFilterPlaceholder={t("assets.search")}
        emptyMessage={t(categories.length === 0 ? "assets.emptyNoCategories" : "assets.empty")}
        exportFileName="fixed-assets"
      />

      {openId && <AssetDialog companyId={companyId} assetId={openId === "new" ? null : openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
