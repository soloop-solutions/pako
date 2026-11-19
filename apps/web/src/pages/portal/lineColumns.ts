import type { ColumnDef } from "@tanstack/react-table";
import type { PortalPricedLineResponse } from "@pako/shared";

import { formatAmount } from "@/lib/payroll-enums";

// Document lines as the API priced them (orders and invoices share the shape).
export function lineColumns(t: (id: string) => string): ColumnDef<PortalPricedLineResponse>[] {
  return [
    { accessorKey: "description", header: t("portal.col.item"), enableSorting: false },
    { accessorKey: "quantity", header: t("portal.col.quantity"), enableSorting: false, meta: { numeric: true } },
    { id: "unit", header: t("portal.col.unit"), enableSorting: false, accessorFn: (l) => l.unitName ?? "" },
    { accessorKey: "unitPrice", header: t("portal.col.price"), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    {
      accessorKey: "discountPercent", header: t("portal.col.discount"), enableSorting: false, meta: { numeric: true },
      cell: ({ getValue }) => ((getValue() as number) > 0 ? `${getValue() as number}%` : "—"),
    },
    { accessorKey: "net", header: t("portal.col.net"), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    { accessorKey: "vat", header: t("portal.col.vat"), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
    { accessorKey: "gross", header: t("portal.col.total"), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
  ];
}
