import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { formatAmount } from "./helpers";
import { staticColumn } from "./reportColumns";
import { ExportButton } from "./shared";
import { useReportExport } from "./useReportExport";

interface StatementDisplayRow {
  key: string;
  kind: "opening" | "row" | "closing";
  date: string;
  type: string;
  documentNumber: string;
  description: string;
  debit: number | undefined;
  credit: number | undefined;
  balance: number;
}

export function VendorStatementDrawer({ companyId, partnerId, from, to, onClose }: { companyId: string; partnerId: string; from: string; to: string; onClose: () => void }) {
  const intl = useIntl();

  const query = useQuery({
    queryKey: ["reports", "vendorStatement", companyId, partnerId, from, to] as const,
    queryFn: () => apiClient.vendorStatement(companyId, partnerId, from, to),
  });
  const exporter = useReportExport(() => apiClient.vendorStatementExport(companyId, partnerId, from, to), "vendor-statement.xlsx");
  const data = query.data;

  const rows = useMemo<StatementDisplayRow[]>(() => {
    if (!data) return [];
    return [
      { key: "opening", kind: "opening", date: "", type: "", documentNumber: "", description: intl.formatMessage({ id: "reports.openingBalance" }), debit: undefined, credit: undefined, balance: data.opening },
      ...data.rows.map(
        (row, index): StatementDisplayRow => ({
          key: `row-${index}`,
          kind: "row",
          date: row.date,
          type: row.type,
          documentNumber: row.documentNumber ?? "",
          description: row.description ?? "",
          debit: row.debit,
          credit: row.credit,
          balance: row.balance,
        }),
      ),
      { key: "closing", kind: "closing", date: "", type: "", documentNumber: "", description: intl.formatMessage({ id: "reports.closingBalance" }), debit: undefined, credit: undefined, balance: data.closing },
    ];
  }, [data, intl]);

  const columns = useMemo<ColumnDef<StatementDisplayRow>[]>(() => {
    const amount = (id: "debit" | "credit" | "balance", header: string) =>
      staticColumn<StatementDisplayRow>({
        id,
        header,
        accessorFn: (row) => row[id],
        cell: ({ row }) => {
          const value = row.original[id];
          return value === undefined ? "" : formatAmount(value);
        },
        meta: { numeric: true },
      });
    return [
      staticColumn<StatementDisplayRow>({ id: "date", header: intl.formatMessage({ id: "common.date" }), accessorFn: (row) => row.date }),
      staticColumn<StatementDisplayRow>({ id: "type", header: intl.formatMessage({ id: "common.type" }), accessorFn: (row) => row.type }),
      staticColumn<StatementDisplayRow>({ id: "documentNumber", header: intl.formatMessage({ id: "reports.documentNumber" }), accessorFn: (row) => row.documentNumber }),
      staticColumn<StatementDisplayRow>({ id: "description", header: intl.formatMessage({ id: "common.description" }), accessorFn: (row) => row.description }),
      amount("debit", intl.formatMessage({ id: "ledger.debit" })),
      amount("credit", intl.formatMessage({ id: "ledger.credit" })),
      amount("balance", intl.formatMessage({ id: "reports.runningBalance" })),
    ];
  }, [intl]);

  const error = query.error ? getApiErrorMessage(query.error, intl.formatMessage({ id: "reports.vendorStatementLoadError" })) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "reports.vendorStatement" })}{data ? ` - ${data.name}` : ""}</DialogTitle>
          <DialogDescription>{`${from} - ${to}`}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4">
          <ExportButton onClick={exporter.exportFile} loading={exporter.exporting} />
        </div>
        {(error || exporter.exportError) && (
          <Alert variant="destructive">
            <AlertDescription>{error ?? exporter.exportError}</AlertDescription>
          </Alert>
        )}
        {data && (
          <DataGrid<StatementDisplayRow>
            gridId="vendorStatement"
            columns={columns}
            data={rows}
            rowCount={rows.length}
            getRowId={(row) => row.key}
            defaultPageSize={1000}
            pageSizeOptions={[1000]}
            getRowClassName={(row) => (row.kind === "row" ? undefined : "bg-muted/60 font-semibold")}
            footerRow={{
              label: intl.formatMessage({ id: "common.total" }),
              cells: { debit: formatAmount(data.totalDebit), credit: formatAmount(data.totalCredit) },
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
