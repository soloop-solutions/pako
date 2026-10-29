import type { FileResponse } from "@pako/shared";

export type ExcelRow = (string | number)[];

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

// F10 lock-awareness is scoped to the two real, backend-enforced lock fields on `Company`
// (accountingLockDate/taxLockDate — see JournalEntry.Post()'s lock-date checks). The other three
// lock types in LockDatesSettings.tsx (sale/purchase/hard) are a self-contained mock with zero
// server enforcement and their own independent in-memory state, not synced with these real fields
// — surfacing them here as "locked" would risk an accountant thinking a real period is closed when
// nothing on the backend actually blocks it. Dates are plain ISO (YYYY-MM-DD) strings throughout
// this file already, so a lexicographic comparison is a correct "on or before" check.
export function isOnOrBeforeLock(date: string, lockDate: string | undefined): boolean {
  return !!lockDate && date <= lockDate;
}

// Dynamically imported, same as DataGrid.tsx's own export button — keeps the xlsx library out of
// the main bundle until someone actually exports something.
export function downloadRows(rows: (string | number)[][], fileName: string): void {
  void import("@/components/data-grid/exportToExcel").then(({ exportRowsToExcel }) => exportRowsToExcel(rows, fileName));
}

// Sales/purchase book export goes through the real backend endpoint (GET .../export, an xlsx
// built server-side by ExcelExportService) rather than the client-side xlsx composition
// downloadRows does for pnl/balance-sheet/vat/debt above — ReportsController already builds and
// serves the real file for these two, so there's no reason to re-derive it in the browser.
export function downloadFileResponse(file: FileResponse, fallbackFileName: string): void {
  const url = URL.createObjectURL(file.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName ?? fallbackFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}
