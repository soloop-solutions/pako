import type { RowData } from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
    footerAggregate?: "sum" | "count" | "none";
    filterVariant?: "text" | "select";
    filterOptions?: Array<{ label: string; value: string }>;
    groupable?: boolean;
    headerLabel?: string;
  }
}

export interface DataGridSort {
  id: string;
  desc: boolean;
}
