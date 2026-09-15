import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { BillResponse, DocumentBalanceResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useCompany } from "@/context/CompanyContext";
import { BillDocumentType } from "@/lib/document-types";
import { taxesForPurchase } from "@/lib/tax-enums";
import { BillForm } from "@/pages/bills/BillForm";

const GRID_ID = "purchaseReturns";

// A6 (v2 release): AP mirror of SalesReturns.tsx — form fixed to PurchaseReturn with a required
// original-bill picker, grid only ever shows PurchaseReturn rows.
export function PurchaseReturns() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [bills, setBills] = useState<BillResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, billsResult, taxesResult, paymentMethodsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.billsAll(companyId),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
      ]);
      setPartners(partnersResult);
      setBills(billsResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);

      const returns = billsResult.filter((bill) => bill.documentType === BillDocumentType.PurchaseReturn);
      const balanceEntries = await Promise.all(
        returns.map(async (bill) => [bill.id, await apiClient.balance(companyId, bill.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "purchaseReturns.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const vendors = partners.filter((p) => p.isVendor);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  // `balances` is a dependency here too — see Invoicing.tsx's identical comment for why a
  // balance-dependent column needs the `data` array reference to change when balances update.
  const returns = useMemo(
    () => bills.filter((bill) => bill.documentType === BillDocumentType.PurchaseReturn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills, balances],
  );

  const columns = useMemo<ColumnDef<BillResponse>[]>(
    () => [
      {
        accessorKey: "vendorReference",
        header: intl.formatMessage({ id: "bills.vendorInvoiceNumber" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        id: "vendor",
        header: intl.formatMessage({ id: "common.vendor" }),
        accessorFn: (row) => partnerName(row.partnerId),
      },
      {
        id: "originalBill",
        header: intl.formatMessage({ id: "purchaseReturns.originalBill" }),
        accessorFn: (row) => {
          const original = bills.find((candidate) => candidate.id === row.originalBillId);
          return original?.vendorReference ?? row.originalBillId ?? "-";
        },
      },
      {
        accessorKey: "issueDate",
        header: intl.formatMessage({ id: "invoicing.issueDate" }),
      },
      {
        accessorKey: "state",
        header: intl.formatMessage({ id: "invoicing.state" }),
        cell: ({ getValue }) => {
          const state = getValue() as string;
          return <Badge variant={state === "Posted" ? "default" : "secondary"}>{state}</Badge>;
        },
      },
      {
        id: "returnedAmount",
        header: intl.formatMessage({ id: "purchaseReturns.returnedAmount" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        accessorFn: (row) => (row.state === "Posted" ? balances[row.id]?.total : undefined),
        cell: ({ getValue, row }) => {
          const value = getValue() as number | undefined;
          if (row.original.state !== "Posted") return "-";
          return value !== undefined ? value.toFixed(2) : "...";
        },
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
    [intl, partners, bills, balances],
  );

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "purchaseReturns.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "purchaseReturns.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "purchaseReturns.newReturn" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "purchaseReturns.newReturnDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <BillForm
            companyId={activeCompany.id}
            vendors={vendors}
            taxes={taxesForPurchase(taxes)}
            bills={bills}
            paymentMethods={paymentMethods}
            isVatRegistered={activeCompany.isVatRegistered}
            onCreated={refresh}
            fixedDocumentType={BillDocumentType.PurchaseReturn}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "purchaseReturns.returnsTable" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={returns}
            rowCount={returns.length}
            getRowId={(row) => row.id}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "purchaseReturns.noReturns" })}
            exportFileName="purchase-returns"
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
