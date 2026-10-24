import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  AccountResponse,
  DocumentBalanceResponse,
  InvoiceResponse,
  ItemResponse,
  PartnerResponse,
  PaymentMethodResponse,
  TaxDefinitionResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { documentStateBadgeVariant, getDocumentRowClassName, InvoiceDocumentType, invoiceDocumentTypeLabel } from "@/lib/document-types";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";
import { PartnerForm } from "@/pages/shared/PartnerForm";

const GRID_ID = "invoices";

export function Invoicing() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  // F5 — item picker on the line editor and the accounts its default revenue account is picked
  // from. `itemsGET`'s `take` is capped at 200 server-side (see Items.tsx's own comment) — a
  // plain <select> stays usable up to that many, per docs/FRONTEND_BRIEF.md's F5 instruction to
  // only reach for a searchable combobox if a plain select is genuinely unusable.
  const [items, setItems] = useState<ItemResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [invoiceFormOpen, setInvoiceFormOpen] = useState(false);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [invoiceFormKey, setInvoiceFormKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, invoicesResult, taxesResult, paymentMethodsResult, itemsResult, accountsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.invoicesAll(companyId),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
        apiClient.itemsGET(companyId, 1, 200, undefined, undefined),
        apiClient.accountsAll(companyId),
      ]);
      setPartners(partnersResult);
      setInvoices(invoicesResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);
      setItems(itemsResult.items);
      setAccounts(accountsResult);

      const balanceEntries = await Promise.all(
        invoicesResult.map(async (invoice) => [invoice.id, await apiClient.balance2(companyId, invoice.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "invoicing.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  // A6 (v2 release): Sales returns and Proforma now have their own pages — this grid stays
  // scoped to what this page's create form can actually produce (Invoice/CreditNote/DebitNote/
  // DownPayment). The full `invoices` array (unfiltered) still passes through to InvoiceForm so
  // its original-invoice picker for CreditNote/DebitNote is unaffected.
  // `balances` is included as a dependency (even though the filter predicate itself doesn't use
  // it) so this array gets a fresh reference whenever a balance finishes loading asynchronously —
  // DataGrid's underlying TanStack Table caches each row's computed cell values keyed off row
  // identity, and only invalidates that cache when the `data` array reference itself changes, so
  // the "outstanding" column (whose accessorFn reads `balances`) would otherwise stay stuck at
  // its first (pre-fetch) value forever.
  const displayedInvoices = useMemo(
    () =>
      invoices.filter(
        (invoice) => invoice.documentType !== InvoiceDocumentType.SalesReturn && invoice.documentType !== InvoiceDocumentType.Proforma,
      ),
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
        id: "type",
        header: intl.formatMessage({ id: "common.type" }),
        accessorFn: (row) => invoiceDocumentTypeLabel(row.documentType, intl),
        cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
      },
      {
        id: "customer",
        header: intl.formatMessage({ id: "common.customer" }),
        accessorFn: (row) => partnerName(row.partnerId),
      },
      {
        accessorKey: "issueDate",
        header: intl.formatMessage({ id: "invoicing.issueDate" }),
      },
      {
        accessorKey: "dueDate",
        header: intl.formatMessage({ id: "invoicing.dueDate" }),
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
        id: "outstanding",
        header: intl.formatMessage({ id: "invoicing.outstanding" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        accessorFn: (row) => (row.state === "Posted" ? balances[row.id]?.outstanding : undefined),
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
          <Link className="text-sm font-medium text-primary hover:underline" to={`/invoicing/${row.original.id}`}>
            {intl.formatMessage({ id: "common.view" })}
          </Link>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners, balances],
  );

  const handleInvoiceCreated = useCallback(async () => {
    setInvoiceFormOpen(false);
    setInvoiceFormKey((k) => k + 1);
    await refresh();
  }, [refresh]);

  const handleCustomerCreated = useCallback(async () => {
    setCustomerFormOpen(false);
    await refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "invoicing.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "invoicing.description" })}</CardDescription>
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
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "invoicing.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "invoicing.description" })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCustomerFormOpen(true)}>
            {intl.formatMessage({ id: "invoicing.addCustomer" })}
          </Button>
          <Button onClick={() => setInvoiceFormOpen(true)}>
            {intl.formatMessage({ id: "invoicing.newInvoice" })}
          </Button>
        </div>
      </div>

      <FormDialog
        open={customerFormOpen}
        onOpenChange={(open) => { if (!open) setCustomerFormOpen(false); }}
        title={intl.formatMessage({ id: "invoicing.addCustomer" })}
        size="sm"
      >
        <PartnerForm companyId={activeCompany.id} role="customer" onCreated={handleCustomerCreated} />
      </FormDialog>

      <FormDialog
        open={invoiceFormOpen}
        onOpenChange={(open) => { if (!open) setInvoiceFormOpen(false); }}
        title={intl.formatMessage({ id: "invoicing.newInvoice" })}
        description={intl.formatMessage({ id: "invoicing.newInvoiceDescription" })}
        size="full"
      >
        <InvoiceForm
          key={invoiceFormKey}
          companyId={activeCompany.id}
          customers={customers}
          taxes={taxesForSale(taxes)}
          invoices={invoices}
          paymentMethods={paymentMethods}
          items={items}
          accounts={accounts}
          isVatRegistered={activeCompany.isVatRegistered}
          onCreated={handleInvoiceCreated}
        />
      </FormDialog>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "invoicing.invoices" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={displayedInvoices}
            rowCount={displayedInvoices.length}
            getRowId={(row) => row.id}
            getRowClassName={(row) => getDocumentRowClassName(row.state)}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "invoicing.noInvoices" })}
            exportFileName="invoices"
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
