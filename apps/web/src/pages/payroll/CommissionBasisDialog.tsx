import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { CommissionBasisItemResponse } from "@pako/shared";

import { apiClient } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { formatAmount } from "@/lib/payroll-enums";

// G11 drill-down: the posted documents (or payments) a computed commission was based on.
export function CommissionBasisDialog({
  companyId,
  adjustmentId,
  title,
  onClose,
}: {
  companyId: string;
  adjustmentId: string | null;
  title: string;
  onClose: () => void;
}) {
  const intl = useIntl();
  const basisQuery = useQuery({
    queryKey: ["commissionBasis", companyId, adjustmentId],
    queryFn: () => apiClient.getCommissionBasis(companyId, adjustmentId as string),
    enabled: !!adjustmentId,
  });

  const columns = useMemo<ColumnDef<CommissionBasisItemResponse>[]>(
    () => [
      { accessorKey: "invoiceNumber", header: intl.formatMessage({ id: "commission.basis.document" }), cell: ({ getValue }) => (getValue() as string) || "—" },
      { accessorKey: "issueDate", header: intl.formatMessage({ id: "commission.basis.date" }) },
      { accessorKey: "partnerName", header: intl.formatMessage({ id: "commission.basis.partner" }) },
      { accessorKey: "paidOn", header: intl.formatMessage({ id: "commission.basis.paidOn" }), cell: ({ getValue }) => (getValue() as string) || "—" },
      { accessorKey: "invoiceNet", header: intl.formatMessage({ id: "commission.basis.net" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      { accessorKey: "countedAmount", header: intl.formatMessage({ id: "commission.basis.counted" }), meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    ],
    [intl],
  );

  const rows = basisQuery.data ?? [];
  return (
    <FormDialog
      open={!!adjustmentId}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      size="lg"
    >
        <DataGrid
          gridId="commission-basis"
          columns={columns}
          data={rows}
          rowCount={rows.length}
          isLoading={basisQuery.isPending}
          getRowId={(row, i) => `${row.invoiceId}-${i}`}
          emptyMessage={intl.formatMessage({ id: "commission.basis.empty" })}
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
        />
    </FormDialog>
  );
}
