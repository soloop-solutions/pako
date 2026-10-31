import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { VendorBalanceLine } from "@pako/shared";

import { DataGrid } from "@/components/data-grid/DataGrid";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { partnerPath } from "@/lib/entityLinks";

import { formatAmount } from "./helpers";
import { staticColumn } from "./reportColumns";
import { DateRangeFields, ReportShell } from "./ReportShell";
import type { useVendorsReport } from "./useVendorsReport";
import { VendorStatementDrawer } from "./VendorStatementDrawer";

export function VendorsTab({ report, companyId, companyName, accountingLockDate }: { report: ReturnType<typeof useVendorsReport>; companyId: string; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, data } = report;

  const columns = useMemo<ColumnDef<VendorBalanceLine>[]>(() => {
    const amount = (id: keyof Pick<VendorBalanceLine, "opening" | "debit" | "credit" | "closing">, header: string) =>
      staticColumn<VendorBalanceLine>({
        id,
        header,
        accessorFn: (row) => row[id],
        cell: ({ row }) => {
          const value = row.original[id];
          if (id === "closing" && value < 0) {
            return (
              <span data-vendor-owes-us="true" className="font-medium text-amber-700">
                {formatAmount(value)}
              </span>
            );
          }
          return formatAmount(value);
        },
        meta: { numeric: true },
      });
    return [
      staticColumn<VendorBalanceLine>({
        id: "name",
        header: intl.formatMessage({ id: "common.vendor" }),
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <span className="flex items-center justify-between gap-2">
            <span>{row.original.name}</span>
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => report.openVendor(row.original.partnerId)}>
              {intl.formatMessage({ id: "reports.openStatement" })}
            </Button>
          </span>
        ),
      }),
      amount("opening", intl.formatMessage({ id: "reports.openingBalance" })),
      amount("debit", intl.formatMessage({ id: "ledger.debit" })),
      amount("credit", intl.formatMessage({ id: "ledger.credit" })),
      amount("closing", intl.formatMessage({ id: "reports.closingBalance" })),
    ];
  }, [intl, report]);

  const hasNegativeClosing = data?.lines.some((line) => line.closing < 0) ?? false;

  const footerRow = useMemo(
    () => (data ? { label: intl.formatMessage({ id: "common.total" }), cells: { closing: formatAmount(data.totalClosing) } } : undefined),
    [data, intl],
  );

  return (
    <>
      <ReportShell
        titleId="reports.vendors"
        companyName={companyName}
        periodEnd={period.to}
        accountingLockDate={accountingLockDate}
        onExport={report.exportFile}
        exporting={report.exporting}
        exportError={report.exportError}
        error={report.error}
        controls={
          <>
            <DateRangeFields idPrefix="vendors" from={period.from} to={period.to} onFrom={period.setFrom} onTo={period.setTo} />
            <div className="flex items-center gap-2 pb-2">
              <input
                id="vendors-include-zero"
                type="checkbox"
                className="size-4"
                checked={report.includeZero}
                onChange={(event) => report.setIncludeZero(event.target.checked)}
              />
              <Label htmlFor="vendors-include-zero">{intl.formatMessage({ id: "reports.includeZero" })}</Label>
            </div>
          </>
        }
      >
        {hasNegativeClosing && <p className="text-xs text-amber-700">{intl.formatMessage({ id: "reports.vendorOwesUs" })}</p>}
        {data && (
          <DataGrid<VendorBalanceLine>
            gridId="vendors"
            columns={columns}
            data={data.lines}
            rowCount={data.lines.length}
            getRowId={(row) => row.partnerId}
            defaultPageSize={1000}
            pageSizeOptions={[1000]}
            getRowLink={(row) => partnerPath(row.partnerId, "vendor")}
            getRowClassName={(row) => (row.closing < 0 ? "bg-amber-50/60" : undefined)}
            footerRow={footerRow}
          />
        )}
      </ReportShell>
      {report.vendorId && (
        <VendorStatementDrawer
          companyId={companyId}
          partnerId={report.vendorId}
          from={period.from}
          to={period.to}
          onClose={report.closeVendor}
        />
      )}
    </>
  );
}
