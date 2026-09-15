import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import type { DataGridSort } from "@/components/data-grid/types";

const DEFAULT_PAGE_SIZE = 50;

export interface DataGridUrlState {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  sort: DataGridSort | null;
  globalFilter: string;
  columnFilters: Record<string, string>;
  groupBy: string | null;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: DataGridSort | null) => void;
  setGlobalFilter: (value: string) => void;
  setColumnFilter: (columnId: string, value: string) => void;
  setGroupBy: (columnId: string | null) => void;
}

function paramKey(gridId: string, name: string): string {
  return `${gridId}.${name}`;
}

export function useDataGridUrlState(gridId: string, defaultPageSize = DEFAULT_PAGE_SIZE): DataGridUrlState {
  const [searchParams, setSearchParams] = useSearchParams();

  const pageKey = paramKey(gridId, "page");
  const pageSizeKey = paramKey(gridId, "pageSize");
  const sortKey = paramKey(gridId, "sort");
  const qKey = paramKey(gridId, "q");
  const groupKey = paramKey(gridId, "group");
  const filterPrefix = paramKey(gridId, "f.");

  const page = Math.max(1, Number(searchParams.get(pageKey) ?? "1") || 1);
  const pageSize = Math.max(1, Number(searchParams.get(pageSizeKey) ?? String(defaultPageSize)) || defaultPageSize);

  const sortRaw = searchParams.get(sortKey);
  const sort: DataGridSort | null = sortRaw
    ? sortRaw.startsWith("-")
      ? { id: sortRaw.slice(1), desc: true }
      : { id: sortRaw, desc: false }
    : null;

  const globalFilter = searchParams.get(qKey) ?? "";
  const groupBy = searchParams.get(groupKey);

  const columnFilters = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith(filterPrefix) && value) {
        result[key.slice(filterPrefix.length)] = value;
      }
    }
    return result;
  }, [searchParams, filterPrefix]);

  const setPage = useCallback(
    (next: number) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next <= 1) params.delete(pageKey);
        else params.set(pageKey, String(next));
        return params;
      }, { replace: true });
    },
    [setSearchParams, pageKey],
  );

  const setPageSize = useCallback(
    (next: number) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === defaultPageSize) params.delete(pageSizeKey);
        else params.set(pageSizeKey, String(next));
        params.delete(pageKey);
        return params;
      }, { replace: true });
    },
    [setSearchParams, pageSizeKey, pageKey, defaultPageSize],
  );

  const setSort = useCallback(
    (next: DataGridSort | null) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (!next) params.delete(sortKey);
        else params.set(sortKey, next.desc ? `-${next.id}` : next.id);
        return params;
      }, { replace: true });
    },
    [setSearchParams, sortKey],
  );

  const setGlobalFilter = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (!value) params.delete(qKey);
        else params.set(qKey, value);
        params.delete(pageKey);
        return params;
      }, { replace: true });
    },
    [setSearchParams, qKey, pageKey],
  );

  const setColumnFilter = useCallback(
    (columnId: string, value: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        const key = `${filterPrefix}${columnId}`;
        if (!value) params.delete(key);
        else params.set(key, value);
        params.delete(pageKey);
        return params;
      }, { replace: true });
    },
    [setSearchParams, filterPrefix, pageKey],
  );

  const setGroupBy = useCallback(
    (columnId: string | null) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (!columnId) params.delete(groupKey);
        else params.set(groupKey, columnId);
        return params;
      }, { replace: true });
    },
    [setSearchParams, groupKey],
  );

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    sort,
    globalFilter,
    columnFilters,
    groupBy: groupBy || null,
    setPage,
    setPageSize,
    setSort,
    setGlobalFilter,
    setColumnFilter,
    setGroupBy,
  };
}
