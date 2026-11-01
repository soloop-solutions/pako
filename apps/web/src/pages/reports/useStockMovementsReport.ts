import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ApiException } from "@pako/shared";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";

import { useClampPage } from "./useClampPage";
import { useReportExport } from "./useReportExport";
import { useReportPeriod } from "./useReportPeriod";

export const STOCK_MOVEMENTS_GRID_ID = "stockMovements";
export const STOCK_MOVEMENTS_SORTABLE = new Set(["code", "name", "closingValue", "markup"]);

export function useStockMovementsReport(companyId: string | null, enabled: boolean) {
  const intl = useIntl();
  const period = useReportPeriod();
  const grid = useDataGridUrlState(STOCK_MOVEMENTS_GRID_ID, 50);
  const categoryId = period.searchParams.get("category") || undefined;
  const warehouseId = period.searchParams.get("warehouse") || undefined;
  const search = grid.globalFilter || undefined;
  const sort = grid.sort && STOCK_MOVEMENTS_SORTABLE.has(grid.sort.id) ? `${grid.sort.desc ? "-" : ""}${grid.sort.id}` : undefined;

  const query = useQuery({
    queryKey: ["reports", "stockMovements", companyId, period.from, period.to, search, categoryId, warehouseId, grid.page, grid.pageSize, sort] as const,
    queryFn: () =>
      apiClient.stockMovementsReport(companyId as string, period.from, period.to, search, categoryId, warehouseId, grid.page, grid.pageSize, sort),
    enabled: enabled && !!companyId,
    placeholderData: keepPreviousData,
    retry: false,
  });

  useClampPage(grid, query.data?.total, !query.isPlaceholderData);

  const categories = useQuery({
    queryKey: ["reports", "stockCategories", companyId] as const,
    queryFn: () => apiClient.listItemCategories(companyId as string),
    enabled: enabled && !!companyId,
  });
  const warehouses = useQuery({
    queryKey: ["reports", "stockWarehouses", companyId] as const,
    queryFn: () => apiClient.listWarehouses(companyId as string),
    enabled: enabled && !!companyId,
  });

  const exporter = useReportExport(
    () => apiClient.stockMovementsExport(companyId as string, period.from, period.to, search, categoryId, warehouseId, sort),
    "stock-movements.xlsx",
  );

  const forbidden = query.error instanceof ApiException && query.error.status === 403;

  return {
    period,
    categoryId,
    warehouseId,
    search,
    categories: categories.data ?? [],
    warehouses: warehouses.data ?? [],
    data: query.data,
    loading: query.isFetching,
    forbidden,
    error: query.error
      ? forbidden
        ? intl.formatMessage({ id: "reports.smForbidden" })
        : getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.smLoadError" }))
      : null,
    ...exporter,
  };
}
