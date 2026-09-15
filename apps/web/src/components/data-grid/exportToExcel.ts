import * as XLSX from "xlsx";
import type { Table } from "@tanstack/react-table";

export function exportTableToExcel<TData>(table: Table<TData>, fileName: string): void {
  const columns = table.getVisibleLeafColumns().filter((column) => !column.id.startsWith("__"));
  const header = columns.map((column) => {
    const meta = column.columnDef.meta;
    if (meta?.headerLabel) return meta.headerLabel;
    if (typeof column.columnDef.header === "string") return column.columnDef.header;
    return column.id;
  });
  const rows = table
    .getRowModel()
    .rows.filter((row) => !row.getIsGrouped())
    .map((row) => columns.map((column) => row.getValue(column.id)));

  const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

// For report screens (F10): a report is not a paginated register — it's a fixed, already-computed
// set of sections (e.g. income/expenses, or bucketed totals) with summary rows that don't fit a
// single flat TanStack table. This takes the exact rows already rendered on screen (built by the
// caller straight from the report response, never re-derived) and writes them as one sheet, in the
// same order they appear in the UI.
export function exportRowsToExcel(rows: (string | number)[][], fileName: string): void {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  XLSX.writeFile(workbook, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}
