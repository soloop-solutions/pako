import { keepPreviousData, useQuery, type QueryKey } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";

import { useDataGridUrlState, type DataGridUrlState } from "@/components/data-grid/useDataGridUrlState";

export interface PagedRequest {
  page: number;
  pageSize: number;
  search: string | undefined;
  sort: string | undefined;
  filters: Record<string, string>;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
}

export interface UsePagedGridOptions<T> {
  gridId: string;
  enabled: boolean;
  queryKey: QueryKey;
  fetchPage: (request: PagedRequest) => Promise<PagedResult<T>>;
  defaultPageSize?: number;
}

export function usePagedGrid<T>({ gridId, enabled, queryKey, fetchPage, defaultPageSize = 50 }: UsePagedGridOptions<T>) {
  const urlState: DataGridUrlState = useDataGridUrlState(gridId, defaultPageSize);
  const search = urlState.globalFilter.trim() || undefined;
  const sort = urlState.sort ? `${urlState.sort.desc ? "-" : ""}${urlState.sort.id}` : undefined;

  const query = useQuery({
    queryKey: [...queryKey, gridId, urlState.page, urlState.pageSize, search ?? "", sort ?? "", JSON.stringify(urlState.columnFilters)],
    queryFn: () => fetchPage({ page: urlState.page, pageSize: urlState.pageSize, search, sort, filters: urlState.columnFilters }),
    enabled,
    placeholderData: keepPreviousData,
  });

  return {
    urlState,
    query,
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
  };
}

function columnKey<T>(column: ColumnDef<T>): string | undefined {
  if (column.id) return column.id;
  return "accessorKey" in column && typeof column.accessorKey === "string" ? column.accessorKey : undefined;
}

export function serverSideColumns<T>(columns: ColumnDef<T>[], sortableIds?: string[], filterableIds: string[] = []): ColumnDef<T>[] {
  return columns.map((column) => {
    const key = columnKey(column);
    const sortable = sortableIds === undefined || (key !== undefined && sortableIds.includes(key));
    const filterable = key !== undefined && filterableIds.includes(key);
    return { ...column, enableColumnFilter: filterable, enableGrouping: false, ...(sortable ? {} : { enableSorting: false }) };
  });
}
