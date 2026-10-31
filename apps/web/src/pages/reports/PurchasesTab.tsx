import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import type { PurchaseByItemLine, PurchaseByVendorLine, PurchaseTransactionLine } from "@pako/shared";

import { DataGrid } from "@/components/data-grid/DataGrid";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { formatAmount } from "./helpers";
import { staticColumn } from "./reportColumns";
import { DateRangeFields, ReportShell } from "./ReportShell";
import {
  PURCHASES_VIEWS,
  PURCHASE_TRANSACTIONS_GRID_ID,
  PURCHASE_TRANSACTIONS_SORTABLE,
  type PurchasesView,
  type usePurchasesReport,
} from "./usePurchasesReport";

const VIEW_LABELS: Record<PurchasesView, string> = {
  "by-vendor": "reports.purchasesByVendor",
  "by-item": "reports.purchasesByItem",
  transactions: "reports.purchaseTransactions",
};

function money<T extends object>(id: string, header: string, pick: (row: T) => number, sortable = false): ColumnDef<T> {
  return staticColumn<T>({
    id,
    header,
    accessorFn: pick,
    enableSorting: sortable,
    cell: ({ row }) => formatAmount(pick(row.original)),
    meta: { numeric: true },
  });
}

export function PurchasesTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof usePurchasesReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const { period, view } = report;
  const totalLabel = intl.formatMessage({ id: "common.total" });

  const vendorColumns = useMemo<ColumnDef<PurchaseByVendorLine>[]>(
    () => [
      staticColumn<PurchaseByVendorLine>({ id: "name", header: intl.formatMessage({ id: "common.vendor" }), accessorFn: (row) => row.name }),
      money<PurchaseByVendorLine>("netAmount", intl.formatMessage({ id: "reports.purchasesNet" }), (row) => row.netAmount),
      money<PurchaseByVendorLine>("discountAmount", intl.formatMessage({ id: "reports.purchasesDiscount" }), (row) => row.discountAmount),
      money<PurchaseByVendorLine>("vatAmount", intl.formatMessage({ id: "reports.purchasesVat" }), (row) => row.vatAmount),
      money<PurchaseByVendorLine>("grossAmount", intl.formatMessage({ id: "reports.purchasesGross" }), (row) => row.grossAmount),
    ],
    [intl],
  );

  const itemColumns = useMemo<ColumnDef<PurchaseByItemLine>[]>(
    () => [
      staticColumn<PurchaseByItemLine>({ id: "itemCode", header: intl.formatMessage({ id: "reports.purchasesItemCode" }), accessorFn: (row) => row.itemCode ?? "" }),
      staticColumn<PurchaseByItemLine>({ id: "description", header: intl.formatMessage({ id: "common.description" }), accessorFn: (row) => row.description }),
      staticColumn<PurchaseByItemLine>({ id: "unit", header: intl.formatMessage({ id: "reports.purchasesUnit" }), accessorFn: (row) => row.unit ?? "" }),
      staticColumn<PurchaseByItemLine>({
        id: "quantity",
        header: intl.formatMessage({ id: "common.quantity" }),
        accessorFn: (row) => row.quantity,
        cell: ({ row }) => row.original.quantity.toFixed(2),
        meta: { numeric: true },
      }),
      money<PurchaseByItemLine>("netAmount", intl.formatMessage({ id: "reports.purchasesNet" }), (row) => row.netAmount),
      money<PurchaseByItemLine>("vatAmount", intl.formatMessage({ id: "reports.purchasesVat" }), (row) => row.vatAmount),
      money<PurchaseByItemLine>("grossAmount", intl.formatMessage({ id: "reports.purchasesGross" }), (row) => row.grossAmount),
    ],
    [intl],
  );

  const transactionColumns = useMemo<ColumnDef<PurchaseTransactionLine>[]>(() => {
    const text = (id: string, header: string, pick: (row: PurchaseTransactionLine) => string) =>
      staticColumn<PurchaseTransactionLine>({ id, header, accessorFn: pick, enableSorting: PURCHASE_TRANSACTIONS_SORTABLE.has(id) });
    return [
      text("date", intl.formatMessage({ id: "common.date" }), (row) => row.date),
      text("document", intl.formatMessage({ id: "reports.documentNumber" }), (row) => row.documentNumber ?? ""),
      text("vendor", intl.formatMessage({ id: "common.vendor" }), (row) => row.partnerName),
      text("itemCode", intl.formatMessage({ id: "reports.purchasesItemCode" }), (row) => row.itemCode ?? ""),
      text("description", intl.formatMessage({ id: "common.description" }), (row) => row.description),
      staticColumn<PurchaseTransactionLine>({
        id: "quantity",
        header: intl.formatMessage({ id: "common.quantity" }),
        accessorFn: (row) => row.quantity,
        cell: ({ row }) => row.original.quantity.toFixed(2),
        meta: { numeric: true },
      }),
      staticColumn<PurchaseTransactionLine>({
        id: "unitPrice",
        header: intl.formatMessage({ id: "reports.purchasesUnitPrice" }),
        accessorFn: (row) => row.unitPrice,
        cell: ({ row }) => String(row.original.unitPrice),
        meta: { numeric: true },
      }),
      money<PurchaseTransactionLine>("net", intl.formatMessage({ id: "reports.purchasesNet" }), (row) => row.netAmount, PURCHASE_TRANSACTIONS_SORTABLE.has("net")),
      money<PurchaseTransactionLine>("vatAmount", intl.formatMessage({ id: "reports.purchasesVat" }), (row) => row.vatAmount, PURCHASE_TRANSACTIONS_SORTABLE.has("vatAmount")),
      money<PurchaseTransactionLine>("gross", intl.formatMessage({ id: "reports.purchasesGross" }), (row) => row.grossAmount, PURCHASE_TRANSACTIONS_SORTABLE.has("gross")),
    ];
  }, [intl]);

  return (
    <ReportShell
      titleId="reports.purchases"
      companyName={companyName}
      periodEnd={period.to}
      accountingLockDate={accountingLockDate}
      onExport={report.exportFile}
      exporting={report.exporting}
      exportError={report.exportError}
      error={report.error}
      controls={
        <>
          <div className="flex gap-1">
            {PURCHASES_VIEWS.map((v) => (
              <Button key={v} type="button" size="sm" variant={view === v ? "default" : "outline"} onClick={() => report.setView(v)}>
                {intl.formatMessage({ id: VIEW_LABELS[v] })}
              </Button>
            ))}
          </div>
          <DateRangeFields idPrefix="purchases" from={period.from} to={period.to} onFrom={period.setFrom} onTo={period.setTo} />
          {view === "transactions" && (
            <div className="flex flex-col gap-2">
              <Label>{intl.formatMessage({ id: "common.vendor" })}</Label>
              <Select
                className="w-56"
                aria-label={intl.formatMessage({ id: "common.vendor" })}
                value={report.partnerId ?? ""}
                onValueChange={(value) => period.setParam("partnerId", value || null)}
                options={[
                  { value: "", label: intl.formatMessage({ id: "reports.purchasesAllVendors" }) },
                  ...report.partners.map((partner) => ({ value: partner.id, label: partner.name })),
                ]}
              />
            </div>
          )}
        </>
      }
    >
      {view === "by-vendor" && report.byVendor && (
        <DataGrid<PurchaseByVendorLine>
          gridId="purchasesByVendor"
          columns={vendorColumns}
          data={report.byVendor.lines}
          rowCount={report.byVendor.lines.length}
          getRowId={(row) => row.partnerId}
          defaultPageSize={1000}
          pageSizeOptions={[1000]}
          footerRow={{
            label: totalLabel,
            cells: {
              netAmount: formatAmount(report.byVendor.totalNet),
              discountAmount: formatAmount(report.byVendor.totalDiscount),
              vatAmount: formatAmount(report.byVendor.totalVat),
              grossAmount: formatAmount(report.byVendor.totalGross),
            },
          }}
        />
      )}
      {view === "by-item" && report.byItem && (
        <DataGrid<PurchaseByItemLine>
          gridId="purchasesByItem"
          columns={itemColumns}
          data={report.byItem.lines}
          rowCount={report.byItem.lines.length}
          getRowId={(row, index) => `${row.itemId ?? row.description}-${index}`}
          defaultPageSize={1000}
          pageSizeOptions={[1000]}
          footerRow={{
            label: totalLabel,
            cells: {
              netAmount: formatAmount(report.byItem.totalNet),
              vatAmount: formatAmount(report.byItem.totalVat),
              grossAmount: formatAmount(report.byItem.totalGross),
            },
          }}
        />
      )}
      {view === "transactions" && (
        <DataGrid<PurchaseTransactionLine>
          gridId={PURCHASE_TRANSACTIONS_GRID_ID}
          columns={transactionColumns}
          data={report.transactions?.items ?? []}
          rowCount={report.transactions?.total ?? 0}
          isLoading={report.loading && !report.transactions}
          getRowId={(row, index) => `${row.documentNumber}-${index}`}
          enableGlobalFilter
          globalFilterPlaceholder={intl.formatMessage({ id: "reports.purchasesSearchPlaceholder" })}
          footerRow={
            report.transactions
              ? {
                  label: totalLabel,
                  cells: {
                    net: formatAmount(report.transactions.totalNet),
                    vatAmount: formatAmount(report.transactions.totalVat),
                    gross: formatAmount(report.transactions.totalGross),
                  },
                }
              : undefined
          }
        />
      )}
    </ReportShell>
  );
}
