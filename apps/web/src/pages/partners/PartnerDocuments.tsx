import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { BillResponse, InvoiceResponse } from "@pako/shared";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { BillDocumentType, InvoiceDocumentType, billDocumentTypeLabel, invoiceDocumentTypeLabel } from "@/lib/document-types";
import { entityPath } from "@/lib/entityLinks";
import { formatAmount } from "@/lib/payroll-enums";

const PAGE_SIZE = 100;

function invoiceRowLink(row: Pick<InvoiceResponse, "id" | "documentType">): string | null {
  return entityPath({ kind: row.documentType === InvoiceDocumentType.SalesReturn ? "SalesReturn" : "Invoice", id: row.id });
}

function billRowLink(row: Pick<BillResponse, "id" | "documentType">): string | null {
  return entityPath({ kind: row.documentType === BillDocumentType.PurchaseReturn ? "PurchaseReturn" : "Bill", id: row.id });
}

export function PartnerDocuments({ companyId, partnerId, showSales, showPurchases }: { companyId: string; partnerId: string; showSales: boolean; showPurchases: boolean }) {
  const intl = useIntl();

  const invoicesQuery = useQuery({
    queryKey: ["partnerDocuments", "invoices", companyId, partnerId],
    queryFn: () => apiClient.paged2(companyId, 1, PAGE_SIZE, undefined, undefined, undefined, undefined, "-issueDate", partnerId, undefined, undefined, undefined, undefined, undefined),
    enabled: showSales,
  });
  const billsQuery = useQuery({
    queryKey: ["partnerDocuments", "bills", companyId, partnerId],
    queryFn: () => apiClient.paged(companyId, 1, PAGE_SIZE, undefined, undefined, undefined, undefined, "-issueDate", partnerId, undefined, undefined, undefined, undefined, undefined),
    enabled: showPurchases,
  });

  const invoiceColumns = useMemo<ColumnDef<InvoiceResponse>[]>(
    () => [
      { id: "number", header: intl.formatMessage({ id: "commission.basis.document" }), accessorFn: (row) => row.invoiceNumber ?? "" },
      { id: "type", header: intl.formatMessage({ id: "common.type" }), accessorFn: (row) => invoiceDocumentTypeLabel(row.documentType, intl) },
      { id: "date", header: intl.formatMessage({ id: "common.date" }), accessorFn: (row) => row.issueDate },
      { id: "total", header: intl.formatMessage({ id: "common.total" }), accessorFn: (row) => row.totals?.grossAmount ?? 0, meta: { numeric: true }, cell: ({ row }) => (row.original.totals ? formatAmount(row.original.totals.grossAmount) : "") },
    ],
    [intl],
  );
  const billColumns = useMemo<ColumnDef<BillResponse>[]>(
    () => [
      { id: "number", header: intl.formatMessage({ id: "commission.basis.document" }), accessorFn: (row) => row.vendorReference ?? "" },
      { id: "type", header: intl.formatMessage({ id: "common.type" }), accessorFn: (row) => billDocumentTypeLabel(row.documentType, intl) },
      { id: "date", header: intl.formatMessage({ id: "common.date" }), accessorFn: (row) => row.issueDate },
    ],
    [intl],
  );

  return (
    <div className="mt-4 flex flex-col gap-4">
      {showSales && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{intl.formatMessage({ id: "nav.invoicing" })}</h3>
          <DataGrid<InvoiceResponse>
            gridId="partner-card-invoices"
            columns={invoiceColumns}
            data={invoicesQuery.data?.items ?? []}
            rowCount={invoicesQuery.data?.items.length ?? 0}
            isLoading={invoicesQuery.isPending}
            getRowId={(row) => row.id}
            getRowLink={invoiceRowLink}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </section>
      )}
      {showPurchases && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{intl.formatMessage({ id: "nav.bills" })}</h3>
          <DataGrid<BillResponse>
            gridId="partner-card-bills"
            columns={billColumns}
            data={billsQuery.data?.items ?? []}
            rowCount={billsQuery.data?.items.length ?? 0}
            isLoading={billsQuery.isPending}
            getRowId={(row) => row.id}
            getRowLink={billRowLink}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
          />
        </section>
      )}
    </div>
  );
}
