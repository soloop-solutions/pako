import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import { DataGrid } from "@/components/data-grid/DataGrid";

import { formatAmount } from "./helpers";
import { staticColumn } from "./reportColumns";

export interface ReportRow {
  key: string;
  kind: "section" | "line" | "summary" | "flag";
  code?: string;
  label: string;
  values: (number | undefined)[];
}

const ROW_CLASS: Record<ReportRow["kind"], string | undefined> = {
  section: "bg-muted/60 font-semibold",
  line: undefined,
  summary: "border-t font-semibold",
  flag: "bg-amber-50 font-semibold text-amber-700",
};

interface ReportGridProps {
  gridId: string;
  rows: ReportRow[];
  valueHeaders: string[];
  rowLink?: (row: ReportRow) => string | null;
}

export function ReportGrid({ gridId, rows, valueHeaders, rowLink }: ReportGridProps) {
  const intl = useIntl();
  const headerKey = valueHeaders.join("|");

  const columns = useMemo<ColumnDef<ReportRow>[]>(
    () => [
      staticColumn<ReportRow>({ id: "code", header: intl.formatMessage({ id: "common.code" }), accessorFn: (row) => row.code ?? "" }),
      staticColumn<ReportRow>({ id: "label", header: intl.formatMessage({ id: "ledger.account" }), accessorFn: (row) => row.label }),
      ...valueHeaders.map((header, index) =>
        staticColumn<ReportRow>({
          id: `v${index}`,
          header,
          accessorFn: (row) => row.values[index],
          cell: ({ row }) => {
            const value = row.original.values[index];
            return value === undefined ? "" : formatAmount(value);
          },
          meta: { numeric: true, headerLabel: header },
        }),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, headerKey],
  );

  return (
    <DataGrid<ReportRow>
      gridId={gridId}
      columns={columns}
      data={rows}
      rowCount={rows.length}
      getRowId={(row) => row.key}
      defaultPageSize={1000}
      pageSizeOptions={[1000]}
      getRowClassName={(row) => ROW_CLASS[row.kind]}
      getRowLink={rowLink}
    />
  );
}
