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
