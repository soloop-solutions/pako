import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { DocumentBalanceResponse, InvoiceResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { documentStateBadgeVariant, getDocumentRowClassName, InvoiceDocumentType } from "@/lib/document-types";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";

const GRID_ID = "salesReturns";

// A6 (v2 release): sales returns get their own nav entry/page rather than being one option in
// the Sales invoices dropdown — the form is fixed to SalesReturn (InvoiceForm's fixedDocumentType
// prop) with a required original-invoice picker, and the grid only ever shows SalesReturn rows.
export function SalesReturns() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, invoicesResult, taxesResult, paymentMethodsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.invoicesAll(companyId),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
      ]);
      setPartners(partnersResult);
      setInvoices(invoicesResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);

      const returns = invoicesResult.filter((invoice) => invoice.documentType === InvoiceDocumentType.SalesReturn);
      const balanceEntries = await Promise.all(
        returns.map(async (invoice) => [invoice.id, await apiClient.balance2(companyId, invoice.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "salesReturns.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  // `balances` is a dependency here too — see Invoicing.tsx's identical comment for why a
  // balance-dependent column needs the `data` array reference to change when balances update.
  const returns = useMemo(
    () => invoices.filter((invoice) => invoice.documentType === InvoiceDocumentType.SalesReturn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, balances],
  );

  const columns = useMemo<ColumnDef<InvoiceResponse>[]>(
    () => [
      {
        accessorKey: "invoiceNumber",
        header: intl.formatMessage({ id: "invoicing.number" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        id: "customer",
        header: intl.formatMessage({ id: "common.customer" }),
        accessorFn: (row) => partnerName(row.partnerId),
      },
      {
        id: "originalInvoice",
        header: intl.formatMessage({ id: "salesReturns.originalInvoice" }),
        accessorFn: (row) => {
          const original = invoices.find((candidate) => candidate.id === row.originalInvoiceId);
          return original?.invoiceNumber ?? row.originalInvoiceId ?? "-";
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
          return <Badge variant={documentStateBadgeVariant(state)}>{state}</Badge>;
        },
      },
      {
        id: "returnedAmount",
        header: intl.formatMessage({ id: "salesReturns.returnedAmount" }),
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
          <Link className="text-sm font-medium text-primary hover:underline" to={`/sales-returns/${row.original.id}`}>
            {intl.formatMessage({ id: "common.view" })}
          </Link>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners, invoices, balances],
  );

  const handleCreated = useCallback(async () => {
    setFormOpen(false);
    setFormKey((k) => k + 1);
    await refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "salesReturns.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "salesReturns.description" })}</CardDescription>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "salesReturns.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "salesReturns.description" })}</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          {intl.formatMessage({ id: "salesReturns.newReturn" })}
        </Button>
      </div>

      <FormDialog
        open={formOpen}
        onOpenChange={(open) => { if (!open) setFormOpen(false); }}
        title={intl.formatMessage({ id: "salesReturns.newReturn" })}
        description={intl.formatMessage({ id: "salesReturns.newReturnDescription" })}
        size="full"
      >
        <InvoiceForm
          key={formKey}
          companyId={activeCompany.id}
          customers={customers}
          taxes={taxesForSale(taxes)}
          invoices={invoices}
          paymentMethods={paymentMethods}
          isVatRegistered={activeCompany.isVatRegistered}
          onCreated={handleCreated}
          fixedDocumentType={InvoiceDocumentType.SalesReturn}
        />
      </FormDialog>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "salesReturns.returnsTable" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={returns}
            rowCount={returns.length}
            getRowId={(row) => row.id}
            getRowClassName={(row) => getDocumentRowClassName(row.state)}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "salesReturns.noReturns" })}
            exportFileName="sales-returns"
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
