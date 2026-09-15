import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { BillResponse, DocumentBalanceResponse, InvoiceResponse, PartnerResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useCompany } from "@/context/CompanyContext";

const AR_GRID_ID = "reconciliationAr";
const AP_GRID_ID = "reconciliationAp";

export function Reconciliation() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [bills, setBills] = useState<BillResponse[]>([]);
  const [invoiceBalances, setInvoiceBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [billBalances, setBillBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, invoicesResult, billsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.invoicesAll(companyId),
        apiClient.billsAll(companyId),
      ]);
      setPartners(partnersResult);

      const postedInvoices = invoicesResult.filter((i) => i.state === "Posted");
      const postedBills = billsResult.filter((b) => b.state === "Posted");
      setInvoices(postedInvoices);
      setBills(postedBills);

      const [invoiceBalanceEntries, billBalanceEntries] = await Promise.all([
        Promise.all(postedInvoices.map(async (i) => [i.id, await apiClient.balance2(companyId, i.id)] as const)),
        Promise.all(postedBills.map(async (b) => [b.id, await apiClient.balance(companyId, b.id)] as const)),
      ]);
      setInvoiceBalances(Object.fromEntries(invoiceBalanceEntries));
      setBillBalances(Object.fromEntries(billBalanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "reconciliation.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const outstandingInvoices = useMemo(
    () => invoices.filter((i) => (invoiceBalances[i.id]?.outstanding ?? 0) > 0),
    [invoices, invoiceBalances],
  );
  const outstandingBills = useMemo(
    () => bills.filter((b) => (billBalances[b.id]?.outstanding ?? 0) > 0),
    [bills, billBalances],
  );
  const totalAr = outstandingInvoices.reduce((sum, i) => sum + (invoiceBalances[i.id]?.outstanding ?? 0), 0);
  const totalAp = outstandingBills.reduce((sum, b) => sum + (billBalances[b.id]?.outstanding ?? 0), 0);

  const arColumns = useMemo<ColumnDef<InvoiceResponse>[]>(
    () => [
      {
        accessorKey: "invoiceNumber",
        header: intl.formatMessage({ id: "reconciliation.number" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        id: "customer",
        header: intl.formatMessage({ id: "reconciliation.customer" }),
        accessorFn: (row) => partnerName(row.partnerId),
      },
      {
        accessorKey: "dueDate",
        header: intl.formatMessage({ id: "reconciliation.dueDate" }),
      },
      {
        id: "outstanding",
        header: intl.formatMessage({ id: "reconciliation.outstanding" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        accessorFn: (row) => invoiceBalances[row.id]?.outstanding,
        cell: ({ getValue }) => (getValue() as number | undefined)?.toFixed(2) ?? "...",
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Link className="text-sm font-medium text-primary hover:underline" to={`/invoicing/${row.original.id}`}>
            {intl.formatMessage({ id: "common.view" })}
          </Link>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners, invoiceBalances],
  );

  const apColumns = useMemo<ColumnDef<BillResponse>[]>(
    () => [
      {
        accessorKey: "vendorReference",
        header: intl.formatMessage({ id: "reconciliation.vendorInvoiceNumber" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        id: "vendor",
        header: intl.formatMessage({ id: "reconciliation.vendor" }),
        accessorFn: (row) => partnerName(row.partnerId),
      },
      {
        accessorKey: "dueDate",
        header: intl.formatMessage({ id: "reconciliation.dueDate" }),
      },
      {
        id: "outstanding",
        header: intl.formatMessage({ id: "reconciliation.outstanding" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        accessorFn: (row) => billBalances[row.id]?.outstanding,
        cell: ({ getValue }) => (getValue() as number | undefined)?.toFixed(2) ?? "...",
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Link className="text-sm font-medium text-primary hover:underline" to={`/bills/${row.original.id}`}>
            {intl.formatMessage({ id: "common.view" })}
          </Link>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners, billBalances],
  );

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "reconciliation.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "reconciliation.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <CardDescription className="text-sm text-muted-foreground">
        {intl.formatMessage({ id: "reconciliation.outstandingInfo" })}
      </CardDescription>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "reconciliation.accountsReceivable" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "reconciliation.totalOutstanding" }, { amount: totalAr.toFixed(2) })}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={AR_GRID_ID}
            columns={arColumns}
            data={outstandingInvoices}
            rowCount={outstandingInvoices.length}
            getRowId={(row) => row.id}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "reconciliation.noOutstandingInvoices" })}
            exportFileName="reconciliation-ar"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "reconciliation.accountsPayable" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "reconciliation.totalOutstanding" }, { amount: totalAp.toFixed(2) })}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={AP_GRID_ID}
            columns={apColumns}
            data={outstandingBills}
            rowCount={outstandingBills.length}
            getRowId={(row) => row.id}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "reconciliation.noOutstandingBills" })}
            exportFileName="reconciliation-ap"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
