import type { ColumnDef } from "@tanstack/react-table";

export function staticColumn<TData extends object>(column: ColumnDef<TData>): ColumnDef<TData> {
  return { enableSorting: false, enableColumnFilter: false, enableGrouping: false, ...column };
}
