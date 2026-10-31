import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { PayablesAgingLine, PayablesAgingVendorRow } from "@pako/shared";

import { DataGrid } from "@/components/data-grid/DataGrid";
import { Button } from "@/components/ui/button";
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

  const matrixColumns = useMemo<ColumnDef<PayablesAgingVendorRow>[]>(
    () => [
      staticColumn<PayablesAgingVendorRow>({ id: "partnerName", header: intl.formatMessage({ id: "common.vendor" }), accessorFn: (row) => row.partnerName }),
      ...(data?.buckets ?? []).map((bucket) =>
        staticColumn<PayablesAgingVendorRow>({
          id: `b_${bucket.bucket}`,
          header: intl.messages[`reports.agingBucket.${bucket.bucket}`] ? intl.formatMessage({ id: `reports.agingBucket.${bucket.bucket}` }) : bucket.bucket,
          accessorFn: (row) => row.buckets.find((item) => item.bucket === bucket.bucket)?.total ?? 0,
          cell: ({ row }) => formatAmount(row.original.buckets.find((item) => item.bucket === bucket.bucket)?.total ?? 0),
          meta: { numeric: true },
        }),
      ),
      staticColumn<PayablesAgingVendorRow>({
        id: "total",
        header: intl.formatMessage({ id: "common.total" }),
        accessorFn: (row) => row.total,
        cell: ({ row }) => formatAmount(row.original.total),
        meta: { numeric: true },
      }),
    ],
    [intl, data?.buckets],
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
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="payables-aging-as-of">{intl.formatMessage({ id: "reports.asOf" })}</Label>
            <Input id="payables-aging-as-of" type="date" value={report.asOf} onChange={(event) => report.setAsOf(event.target.value)} />
          </div>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant={report.view === "bill" ? "default" : "outline"} onClick={() => report.setView("bill")}>
              {intl.formatMessage({ id: "reports.agingViewBill" })}
            </Button>
            <Button type="button" size="sm" variant={report.view === "vendor" ? "default" : "outline"} onClick={() => report.setView("vendor")}>
              {intl.formatMessage({ id: "reports.agingViewVendor" })}
            </Button>
          </div>
        </>
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
          {report.view === "vendor" ? (
            <div data-testid="vendor-matrix">
              <DataGrid<PayablesAgingVendorRow>
                gridId="payablesAgingVendors"
                columns={matrixColumns}
                data={data.vendorMatrix}
                rowCount={data.vendorMatrix.length}
                getRowId={(row) => row.partnerId}
                defaultPageSize={1000}
                pageSizeOptions={[1000]}
                footerRow={{
                  label: intl.formatMessage({ id: "common.total" }),
                  cells: Object.fromEntries(data.buckets.map((bucket) => [`b_${bucket.bucket}`, formatAmount(bucket.total)])),
                }}
              />
            </div>
          ) : (
            <DataGrid<PayablesAgingLine>
              gridId="payablesAging"
              columns={columns}
              data={data.lines}
              rowCount={data.lines.length}
              getRowId={(row) => row.billId}
              defaultPageSize={1000}
              pageSizeOptions={[1000]}
            />
          )}
        </>
      )}
    </ReportShell>
  );
}
