import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type GroupingState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Columns3, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import "@/components/data-grid/types";
import { useColumnVisibility } from "@/components/data-grid/useColumnVisibility";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";

const SELECT_COLUMN_ID = "__select";
const ROW_HEIGHT_CLASS = "h-[30px]";
const SEARCH_DEBOUNCE_MS = 300;

export interface DataGridProps<TData extends object> {
  gridId: string;
  columns: ColumnDef<TData>[];
  data: TData[];
  rowCount: number;
  isLoading?: boolean;
  getRowId?: (row: TData, index: number) => string;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
  enableRowSelection?: boolean;
  onSelectedRowsChange?: (rows: TData[]) => void;
  getRowClassName?: (row: TData) => string | undefined;
  enableGlobalFilter?: boolean;
  globalFilterPlaceholder?: string;
  emptyMessage?: string;
  exportFileName?: string;
  // manualFiltering/manualSorting/manualGrouping default true: column filters, header-click sort,
  // and group-by only write to the URL, they never reorder/hide the `data` prop as given. Pass
  // false only when `data` is guaranteed to hold the full dataset the consumer cares about (e.g. a
  // small, fully-loaded register) — otherwise these controls would silently transform just the
  // current page instead of the real backing data, per the endpoint's own paging contract.
  manualFiltering?: boolean;
  manualSorting?: boolean;
  manualGrouping?: boolean;
}

function columnLabel<TData>(column: Column<TData, unknown>): string {
  const meta = column.columnDef.meta;
  if (meta?.headerLabel) return meta.headerLabel;
  if (typeof column.columnDef.header === "string") return column.columnDef.header;
  return column.id;
}

export function DataGrid<TData extends object>({
  gridId,
  columns,
  data,
  rowCount,
  isLoading = false,
  getRowId,
  defaultPageSize = 50,
  pageSizeOptions = [25, 50, 100, 200],
  enableRowSelection = false,
  onSelectedRowsChange,
  getRowClassName,
  enableGlobalFilter = false,
  globalFilterPlaceholder,
  emptyMessage,
  exportFileName,
  manualFiltering = true,
  manualSorting = true,
  manualGrouping = true,
}: DataGridProps<TData>) {
  const intl = useIntl();
  const urlState = useDataGridUrlState(gridId, defaultPageSize);
  const [columnVisibility, setColumnVisibility] = useColumnVisibility(gridId);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false);
  const columnsPanelRef = useRef<HTMLDivElement>(null);
  const [searchDraft, setSearchDraft] = useState(urlState.globalFilter);

  useEffect(() => {
    setSearchDraft(urlState.globalFilter);
  }, [urlState.globalFilter]);

  useEffect(() => {
    if (searchDraft === urlState.globalFilter) return;
    const timeout = setTimeout(() => urlState.setGlobalFilter(searchDraft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  useEffect(() => {
    setRowSelection({});
  }, [gridId, urlState.page, urlState.pageSize, urlState.globalFilter]);

  useEffect(() => {
    if (!columnsPanelOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (columnsPanelRef.current && !columnsPanelRef.current.contains(event.target as Node)) {
        setColumnsPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [columnsPanelOpen]);

  const finalColumns = useMemo<ColumnDef<TData>[]>(() => {
    if (!enableRowSelection) return columns;
    const selectionColumn: ColumnDef<TData> = {
      id: SELECT_COLUMN_ID,
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
      enableHiding: false,
      header: ({ table }) => (
        <input
          type="checkbox"
          className="size-3.5"
          aria-label={intl.formatMessage({ id: "dataGrid.selectAll" })}
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="size-3.5"
          aria-label={intl.formatMessage({ id: "dataGrid.selectRow" })}
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    };
    return [selectionColumn, ...columns];
  }, [columns, enableRowSelection, intl]);

  const sorting: SortingState = useMemo(
    () => (urlState.sort ? [{ id: urlState.sort.id, desc: urlState.sort.desc }] : []),
    [urlState.sort],
  );
  const columnFilters: ColumnFiltersState = useMemo(
    () => Object.entries(urlState.columnFilters).map(([id, value]) => ({ id, value })),
    [urlState.columnFilters],
  );
  const grouping: GroupingState = useMemo(() => (urlState.groupBy ? [urlState.groupBy] : []), [urlState.groupBy]);

  function resolveRowId(row: TData, index: number): string {
    return getRowId ? getRowId(row, index) : String(index);
  }

  const table = useReactTable({
    data,
    columns: finalColumns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      grouping,
    },
    initialState: { expanded: true },
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(rowCount / urlState.pageSize)),
    enableRowSelection,
    getRowId: getRowId ? (row, index) => getRowId(row, index) : undefined,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: (updater) => {
      setRowSelection((old) => {
        const next = typeof updater === "function" ? updater(old) : updater;
        if (onSelectedRowsChange) {
          const selectedIds = new Set(Object.keys(next).filter((id) => next[id]));
          const selectedRows = data.filter((row, index) => selectedIds.has(resolveRowId(row, index)));
          onSelectedRowsChange(selectedRows);
        }
        return next;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    ...(manualFiltering ? {} : { getFilteredRowModel: getFilteredRowModel() }),
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
    ...(manualGrouping ? {} : { getGroupedRowModel: getGroupedRowModel(), getExpandedRowModel: getExpandedRowModel() }),
  });

  function handleSortClick(columnId: string) {
    if (!urlState.sort || urlState.sort.id !== columnId) {
      urlState.setSort({ id: columnId, desc: false });
    } else if (!urlState.sort.desc) {
      urlState.setSort({ id: columnId, desc: true });
    } else {
      urlState.setSort(null);
    }
  }

  const groupableColumns = table.getAllLeafColumns().filter((column) => column.id !== SELECT_COLUMN_ID && column.getCanGroup());
  const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  const hasAggregatedColumn = table
    .getAllLeafColumns()
    .some((column) => column.columnDef.meta?.footerAggregate === "sum" || column.columnDef.meta?.footerAggregate === "count");
  const anyFilterable = table.getAllLeafColumns().some((column) => column.getCanFilter());

  const rows = table.getRowModel().rows;
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const totalPages = Math.max(1, Math.ceil(rowCount / urlState.pageSize));
  const rangeFrom = rowCount === 0 ? 0 : urlState.skip + 1;
  const rangeTo = Math.min(rowCount, urlState.skip + urlState.pageSize);
  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {enableGlobalFilter && (
            <Input
              className="h-8 max-w-xs text-sm"
              placeholder={globalFilterPlaceholder ?? intl.formatMessage({ id: "dataGrid.search" })}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          )}
          {enableRowSelection && selectedCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {intl.formatMessage({ id: "dataGrid.selectedCount" }, { count: selectedCount })}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {groupableColumns.length > 0 && (
            <Select
              className="h-8 w-auto text-xs"
              value={urlState.groupBy ?? ""}
              onChange={(event) => urlState.setGroupBy(event.target.value || null)}
              aria-label={intl.formatMessage({ id: "dataGrid.groupBy" })}
            >
              <option value="">{intl.formatMessage({ id: "dataGrid.noGrouping" })}</option>
              {groupableColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {intl.formatMessage({ id: "dataGrid.groupByColumn" }, { column: columnLabel(column) })}
                </option>
              ))}
            </Select>
          )}
          <div className="relative" ref={columnsPanelRef}>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setColumnsPanelOpen((open) => !open)}>
              <Columns3 className="size-3.5" />
              {intl.formatMessage({ id: "dataGrid.columns" })}
            </Button>
            {columnsPanelOpen && (
              <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border bg-popover p-2 shadow-md">
                {hideableColumns.map((column) => (
                  <label key={column.id} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    {columnLabel(column)}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              void import("@/components/data-grid/exportToExcel").then(({ exportTableToExcel }) =>
                exportTableToExcel(table, exportFileName ?? gridId),
              );
            }}
          >
            <Download className="size-3.5" />
            {intl.formatMessage({ id: "dataGrid.export" })}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table className="text-[13px] [font-variant-numeric:tabular-nums]">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className={cn(ROW_HEIGHT_CLASS, "hover:bg-transparent")}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const isSorted = urlState.sort?.id === header.column.id ? urlState.sort : null;
                  const numeric = header.column.columnDef.meta?.numeric;
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(ROW_HEIGHT_CLASS, "py-1", numeric && "text-right", header.column.id === SELECT_COLUMN_ID && "w-9")}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className={cn("inline-flex items-center gap-1 font-medium hover:text-foreground", numeric && "flex-row-reverse")}
                          onClick={() => handleSortClick(header.column.id)}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {isSorted ? (
                            isSorted.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-30" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
            {anyFilterable && !isLoading && (
              <TableRow className={cn(ROW_HEIGHT_CLASS, "hover:bg-transparent")}>
                {table.getFlatHeaders().map((header) => (
                  <TableHead key={`${header.id}-filter`} className={cn(ROW_HEIGHT_CLASS, "py-1")}>
                    {header.column.getCanFilter() ? (
                      <Input
                        className="h-6 text-xs"
                        value={urlState.columnFilters[header.column.id] ?? ""}
                        placeholder={intl.formatMessage({ id: "dataGrid.filterPlaceholder" })}
                        onChange={(event) => urlState.setColumnFilter(header.column.id, event.target.value)}
                      />
                    ) : null}
                  </TableHead>
                ))}
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: urlState.pageSize }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`} className={ROW_HEIGHT_CLASS}>
                  {Array.from({ length: visibleColumnCount }).map((__, cellIndex) => (
                    <TableCell key={`skeleton-cell-${cellIndex}`} className={cn(ROW_HEIGHT_CLASS, "py-1")}>
                      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className={ROW_HEIGHT_CLASS}>
                <TableCell colSpan={visibleColumnCount} className="py-4 text-center text-muted-foreground">
                  {emptyMessage ?? intl.formatMessage({ id: "dataGrid.noResults" })}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(ROW_HEIGHT_CLASS, getRowClassName?.(row.original), row.getIsSelected() && "bg-muted")}
                >
                  {row.getVisibleCells().map((cell) => {
                    const numeric = cell.column.columnDef.meta?.numeric;
                    if (cell.getIsPlaceholder() || cell.getIsAggregated()) {
                      return <TableCell key={cell.id} className={cn(ROW_HEIGHT_CLASS, "py-1")} />;
                    }
                    if (row.getIsGrouped() && cell.column.id === row.groupingColumnId) {
                      return (
                        <TableCell key={cell.id} className={cn(ROW_HEIGHT_CLASS, "py-1")}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 font-medium"
                            onClick={row.getToggleExpandedHandler()}
                          >
                            {row.getIsExpanded() ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            <span className="text-xs text-muted-foreground">({row.subRows.length})</span>
                          </button>
                        </TableCell>
                      );
                    }
                    if (row.getIsGrouped()) {
                      return <TableCell key={cell.id} className={cn(ROW_HEIGHT_CLASS, "py-1")} />;
                    }
                    return (
                      <TableCell key={cell.id} className={cn(ROW_HEIGHT_CLASS, "py-1", numeric && "text-right tabular-nums")}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
          {!isLoading && hasAggregatedColumn && rows.length > 0 && (
            <tfoot>
              <tr className={cn(ROW_HEIGHT_CLASS, "border-t bg-muted/30 font-medium")}>
                {table.getVisibleLeafColumns().map((column, index) => {
                  if (column.id === SELECT_COLUMN_ID) {
                    return <td key={column.id} className={cn(ROW_HEIGHT_CLASS, "py-1")} />;
                  }
                  const meta = column.columnDef.meta;
                  const isFirstDataColumn = index === (enableRowSelection ? 1 : 0);
                  if (meta?.footerAggregate === "sum" || meta?.footerAggregate === "count") {
                    const aggregate = rows.reduce((total, row) => {
                      if (row.getIsGrouped()) return total;
                      if (meta.footerAggregate === "count") return total + 1;
                      const value = row.getValue(column.id);
                      return typeof value === "number" ? total + value : total;
                    }, 0);
                    return (
                      <td key={column.id} className={cn(ROW_HEIGHT_CLASS, "px-2 py-1 text-right tabular-nums")}>
                        {meta.footerAggregate === "count"
                          ? aggregate
                          : aggregate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    );
                  }
                  return (
                    <td key={column.id} className={cn(ROW_HEIGHT_CLASS, "px-2 py-1 text-muted-foreground")}>
                      {isFirstDataColumn ? intl.formatMessage({ id: "dataGrid.pageTotal" }) : null}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {rowCount === 0
            ? intl.formatMessage({ id: "dataGrid.noResults" })
            : intl.formatMessage({ id: "dataGrid.range" }, { from: rangeFrom, to: rangeTo, total: rowCount })}
        </span>
        <div className="flex items-center gap-2">
          <Select
            className="h-7 w-auto text-xs"
            value={String(urlState.pageSize)}
            onChange={(event) => urlState.setPageSize(Number(event.target.value))}
            aria-label={intl.formatMessage({ id: "dataGrid.rowsPerPage" })}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {intl.formatMessage({ id: "dataGrid.rowsPerPageOption" }, { count: size })}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={urlState.page <= 1}
            onClick={() => urlState.setPage(urlState.page - 1)}
          >
            {intl.formatMessage({ id: "dataGrid.previous" })}
          </Button>
          <span>{intl.formatMessage({ id: "dataGrid.pageOf" }, { current: urlState.page, total: totalPages })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={urlState.page >= totalPages}
            onClick={() => urlState.setPage(urlState.page + 1)}
          >
            {intl.formatMessage({ id: "dataGrid.next" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
