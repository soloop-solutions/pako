import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { ExpenseBookRow } from "@pako/shared";

import { DataGrid } from "@/components/data-grid/DataGrid";

import { formatAmount } from "./helpers";
import { staticColumn } from "./reportColumns";
import { DateRangeFields, ReportShell } from "./ReportShell";
import type { useExpenseBookReport } from "./useExpenseBookReport";

export function ExpenseBookTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof useExpenseBookReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, data } = report;

  const columns = useMemo<ColumnDef<ExpenseBookRow>[]>(() => {
    if (!data) return [];
    return [
      staticColumn<ExpenseBookRow>({ id: "date", header: intl.formatMessage({ id: "common.date" }), accessorFn: (row) => row.date }),
      staticColumn<ExpenseBookRow>({ id: "documentNumber", header: intl.formatMessage({ id: "reports.expenseBookDocument" }), accessorFn: (row) => row.documentNumber ?? "" }),
      staticColumn<ExpenseBookRow>({ id: "partnerName", header: intl.formatMessage({ id: "reports.glPartner" }), accessorFn: (row) => row.partnerName ?? "" }),
      ...data.columns.map((column, index) => {
        const header = `${column.accountCode} ${column.accountName}`;
        return staticColumn<ExpenseBookRow>({
          id: `c${index}`,
          header,
          accessorFn: (row) => row.amounts[index],
          cell: ({ row }) => formatAmount(row.original.amounts[index]),
          meta: { numeric: true, headerLabel: header },
        });
      }),
      staticColumn<ExpenseBookRow>({
        id: "total",
        header: intl.formatMessage({ id: "common.total" }),
        accessorFn: (row) => row.total,
        cell: ({ row }) => formatAmount(row.original.total),
        meta: { numeric: true },
      }),
    ];
  }, [data, intl]);

  const footerRow = useMemo(
    () =>
      data
        ? {
            label: intl.formatMessage({ id: "reports.columnTotals" }),
            cells: Object.fromEntries(data.columnTotals.map((total, index) => [`c${index}`, formatAmount(total)])),
          }
        : undefined,
    [data, intl],
  );

  return (
    <ReportShell
      titleId="reports.expenseBook"
      companyName={companyName}
      periodEnd={period.to}
      accountingLockDate={accountingLockDate}
      onExport={report.exportFile}
      exporting={report.exporting}
      exportError={report.exportError}
      error={report.error}
      controls={<DateRangeFields idPrefix="expense-book" from={period.from} to={period.to} onFrom={period.setFrom} onTo={period.setTo} />}
    >
      {data && (
        <DataGrid<ExpenseBookRow>
          gridId="expenseBook"
          columns={columns}
          data={data.rows}
          rowCount={data.rows.length}
          getRowId={(row, index) => `${row.entryId}-${index}`}
          defaultPageSize={1000}
          pageSizeOptions={[1000]}
          footerRow={footerRow}
        />
      )}
    </ReportShell>
  );
}
