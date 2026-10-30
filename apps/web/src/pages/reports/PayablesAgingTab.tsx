import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { PayablesAgingLine } from "@pako/shared";

import { DataGrid } from "@/components/data-grid/DataGrid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatAmount } from "./helpers";
import { staticColumn } from "./reportColumns";
import { ReportShell } from "./ReportShell";
import type { usePayablesAgingReport } from "./usePayablesAgingReport";

export function PayablesAgingTab({ report, companyName }: { report: ReturnType<typeof usePayablesAgingReport>; companyName: string }) {
  const intl = useIntl();
  const { data } = report;

  const bucketLabel = (bucket: string) => {
    const id = `reports.agingBucket.${bucket}`;
    return intl.messages[id] ? intl.formatMessage({ id }) : bucket;
  };

  const columns = useMemo<ColumnDef<PayablesAgingLine>[]>(
    () => [
      staticColumn<PayablesAgingLine>({ id: "partnerName", header: intl.formatMessage({ id: "common.vendor" }), accessorFn: (row) => row.partnerName }),
      staticColumn<PayablesAgingLine>({ id: "billNumber", header: intl.formatMessage({ id: "reports.billNumber" }), accessorFn: (row) => row.billNumber ?? "" }),
      staticColumn<PayablesAgingLine>({ id: "issueDate", header: intl.formatMessage({ id: "reports.issueDate" }), accessorFn: (row) => row.issueDate }),
      staticColumn<PayablesAgingLine>({ id: "dueDate", header: intl.formatMessage({ id: "reports.dueDate" }), accessorFn: (row) => row.dueDate }),
      staticColumn<PayablesAgingLine>({
        id: "bucket",
        header: intl.formatMessage({ id: "reports.agingBucketColumn" }),
        accessorFn: (row) => row.bucket,
        cell: ({ row }) => {
          const id = `reports.agingBucket.${row.original.bucket}`;
          return intl.messages[id] ? intl.formatMessage({ id }) : row.original.bucket;
        },
      }),
      staticColumn<PayablesAgingLine>({
        id: "outstanding",
        header: intl.formatMessage({ id: "reports.outstanding" }),
        accessorFn: (row) => row.outstanding,
        cell: ({ row }) => formatAmount(row.original.outstanding),
        meta: { numeric: true },
      }),
    ],
    [intl],
  );

  return (
    <ReportShell
      titleId="reports.payablesAging"
      companyName={companyName}
      periodEnd={report.asOf}
      accountingLockDate={undefined}
      onExport={report.exportFile}
      exporting={report.exporting}
      exportError={report.exportError}
      error={report.error}
      controls={
        <div className="flex flex-col gap-2">
          <Label htmlFor="payables-aging-as-of">{intl.formatMessage({ id: "reports.asOf" })}</Label>
          <Input id="payables-aging-as-of" type="date" value={report.asOf} onChange={(event) => report.setAsOf(event.target.value)} />
        </div>
      }
    >
      {data && (
        <>
          <div>
            <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: "reports.agingBucketTotals" })}</h3>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
              {data.buckets.map((bucket) => (
                <div key={bucket.bucket} data-testid={`bucket-${bucket.bucket}`} className="flex flex-col gap-1 rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">{bucketLabel(bucket.bucket)}</span>
                  <span className="text-right text-sm font-semibold tabular-nums">{formatAmount(bucket.total)}</span>
                </div>
              ))}
            </div>
          </div>
          <DataGrid<PayablesAgingLine>
            gridId="payablesAging"
            columns={columns}
            data={data.lines}
            rowCount={data.lines.length}
            getRowId={(row) => row.billId}
            defaultPageSize={1000}
            pageSizeOptions={[1000]}
          />
        </>
      )}
    </ReportShell>
  );
}
