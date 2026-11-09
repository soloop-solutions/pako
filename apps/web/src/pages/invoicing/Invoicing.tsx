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

import { fetchAllItems } from "@/api/fetchAllItems";
import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { serverSideColumns, usePagedGrid } from "@/components/data-grid/usePagedGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { useMyAccess } from "@/hooks/useMyAccess";
import { documentStateBadgeVariant, getDocumentRowClassName, InvoiceDocumentType, invoiceDocumentTypeLabel } from "@/lib/document-types";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";
import { useInvoicePrefill } from "@/pages/invoicing/invoicePrefill";
import { PartnerForm } from "@/pages/shared/PartnerForm";

export type InvoiceRegisterScope = "invoice" | "proforma";

const GRID_IDS: Record<InvoiceRegisterScope, string> = { invoice: "invoices", proforma: "proforma" };

export function Invoicing({ scope = "invoice" }: { scope?: InvoiceRegisterScope }) {
  const isProforma = scope === "proforma";
  const GRID_ID = GRID_IDS[scope];
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const { canWrite } = useMyAccess();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
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
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertMessage, setConvertMessage] = useState<{ text: string; invoiceId: string } | null>(null);
  const [invoiceFormOpen, setInvoiceFormOpen] = useState(false);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [invoiceFormKey, setInvoiceFormKey] = useState(0);
  // docs/POS_PLAN.md P6: ?salesOrder= / ?delivery= opens the form filled from that document.
  const prefill = useInvoicePrefill(companyId, intl.formatMessage({ id: "dist.invoice.nothingToInvoice" }));
  const formOpen = invoiceFormOpen || !!prefill.prefill;
  const closeInvoiceForm = () => {
    setInvoiceFormOpen(false);
    if (prefill.active) prefill.clear();
  };

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, taxesResult, paymentMethodsResult, itemsResult, accountsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
        fetchAllItems(companyId),
        apiClient.accountsAll(companyId),
      ]);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);
      setItems(itemsResult.items);
      setAccounts(accountsResult);

    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: isProforma ? "proforma.loadError" : "invoicing.loadError" })));
    }
  }, [companyId, intl, isProforma]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const documentScopeFilter = useMemo(
    () =>
      isProforma
        ? { documentType: [InvoiceDocumentType.Proforma], excludeDocumentType: undefined }
        : { documentType: undefined, excludeDocumentType: [InvoiceDocumentType.SalesReturn, InvoiceDocumentType.Proforma] },
    [isProforma],
  );

  const paged = usePagedGrid<InvoiceResponse>({
    gridId: GRID_ID,
    enabled: !!companyId,
    queryKey: ["invoices-paged", companyId, scope],
    defaultPageSize: 100,
    fetchPage: async ({ page, pageSize, search, sort, filters }) => {
      const result = await apiClient.paged2(
        companyId as string,
        page,
        pageSize,
        search,
        documentScopeFilter.documentType,
        documentScopeFilter.excludeDocumentType,
        filters.state || undefined,
        sort,
        undefined,
      );
      return { items: result.items, total: result.total };
    },
  });
  const displayedInvoices = useMemo(
    () => [...paged.items],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paged.items, balances],
  );

  useEffect(() => {
    if (!companyId || isProforma) return;
    const missing = displayedInvoices.filter((invoice) => invoice.state === "Posted" && !(invoice.id in balances));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (invoice) => [invoice.id, await apiClient.balance2(companyId, invoice.id)] as const)).then((entries) => {
      if (!cancelled) setBalances((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, displayedInvoices, isProforma]);

  async function handleConvert(proformaId: string) {
    if (!companyId) return;
    setError(null);
    setConvertingId(proformaId);
    try {
      const newInvoice = await apiClient.convertToInvoice(companyId, proformaId);
      setConvertMessage({
        text: intl.formatMessage({ id: "proforma.convertedMessage" }, { number: newInvoice.invoiceNumber ?? newInvoice.id }),
        invoiceId: newInvoice.id,
      });
      await refresh();
      await paged.query.refetch();
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "proforma.convertError" })));
    } finally {
      setConvertingId(null);
    }
  }

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
        enableSorting: false,
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
        enableSorting: false,
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
          <div className="flex items-center justify-end gap-3">
            <Link className="text-sm font-medium text-primary hover:underline" to={`/invoicing/${row.original.id}`}>
              {intl.formatMessage({ id: "common.view" })}
            </Link>
            {isProforma && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={convertingId === row.original.id}
                onClick={() => void handleConvert(row.original.id)}
              >
                {convertingId === row.original.id
                  ? intl.formatMessage({ id: "proforma.converting" })
                  : intl.formatMessage({ id: "proforma.convert" })}
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners, balances, isProforma, convertingId],
  );
  const visibleColumns = useMemo(
    () => serverSideColumns(isProforma ? columns.filter((column) => column.id !== "outstanding") : columns, ["invoiceNumber", "customer", "issueDate", "dueDate", "state"], ["state"]),
    [columns, isProforma],
  );

  const handleInvoiceCreated = useCallback(async () => {
    setInvoiceFormOpen(false);
    if (prefill.active) prefill.clear();
    setInvoiceFormKey((k) => k + 1);
    await refresh();
    await paged.query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, prefill.active, paged.query.refetch]);

  const handleCustomerCreated = useCallback(async () => {
    setCustomerFormOpen(false);
    await refresh();
  }, [refresh]);

  // Inline creation from within InvoiceForm — refresh data without closing the form.
  const handleInlinePartnerCreated = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const handleInlineItemCreated = useCallback(async () => {
    await refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: isProforma ? "proforma.title" : "invoicing.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: isProforma ? "proforma.description" : "invoicing.description" })}</CardDescription>
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
      {prefill.active && prefill.error != null && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {getApiErrorMessage(prefill.error, intl.formatMessage({ id: "dist.invoice.prefillError" }))}
            <Button size="sm" variant="outline" onClick={prefill.clear}>{intl.formatMessage({ id: "common.close" })}</Button>
          </AlertDescription>
        </Alert>
      )}
      {convertMessage && (
        <Alert>
          <AlertDescription>
            {convertMessage.text}{" "}
            <Link className="font-medium text-primary hover:underline" to={`/invoicing/${convertMessage.invoiceId}`}>
              {intl.formatMessage({ id: "common.view" })}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {prefill.isPending && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "dist.invoice.prefillLoading" })}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {canWrite("sales") && (
          <Button onClick={() => setInvoiceFormOpen(true)}>
            {intl.formatMessage({ id: isProforma ? "proforma.newProforma" : "invoicing.newInvoice" })}
          </Button>
        )}
        {canWrite("partners") && (
          <Button variant="outline" onClick={() => setCustomerFormOpen(true)}>
            {intl.formatMessage({ id: "invoicing.addCustomer" })}
          </Button>
        )}
        <div className="ml-auto">
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: isProforma ? "proforma.title" : "invoicing.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: isProforma ? "proforma.description" : "invoicing.description" })}</p>
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
        open={formOpen}
        onOpenChange={(open) => { if (!open) closeInvoiceForm(); }}
        title={intl.formatMessage({ id: isProforma ? "proforma.newProforma" : "invoicing.newInvoice" })}
        description={intl.formatMessage({ id: isProforma ? "proforma.newProformaDescription" : "invoicing.newInvoiceDescription" })}
        size="full"
      >
        <InvoiceForm
          key={`${invoiceFormKey}${prefill.prefill ? "-prefill" : ""}`}
          companyId={activeCompany.id}
          prefill={prefill.prefill}
          customers={customers}
          taxes={taxesForSale(taxes)}
          paymentMethods={paymentMethods}
          items={items}
          accounts={accounts}
          isVatRegistered={activeCompany.isVatRegistered}
          onCreated={handleInvoiceCreated}
          onPartnerCreated={handleInlinePartnerCreated}
          onItemCreated={handleInlineItemCreated}
          fixedDocumentType={isProforma ? InvoiceDocumentType.Proforma : undefined}
        />
      </FormDialog>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: isProforma ? "proforma.proformasTable" : "invoicing.invoices" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={GRID_ID}
            columns={visibleColumns}
            data={displayedInvoices}
            rowCount={paged.total}
            isLoading={paged.query.isPending}
            getRowId={(row) => row.id}
            getRowClassName={(row) => getDocumentRowClassName(row.state)}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: isProforma ? "proforma.noProformas" : "invoicing.noInvoices" })}
            exportFileName={isProforma ? "proforma" : "invoices"}
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
