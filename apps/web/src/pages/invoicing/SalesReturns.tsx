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
import { serverSideColumns, usePagedGrid } from "@/components/data-grid/usePagedGrid";
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
  const [originalNumbers, setOriginalNumbers] = useState<Record<string, string>>({});
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
      const [partnersResult, taxesResult, paymentMethodsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
      ]);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "salesReturns.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const paged = usePagedGrid<InvoiceResponse>({
    gridId: GRID_ID,
    enabled: !!companyId,
    queryKey: ["sales-returns-paged", companyId],
    defaultPageSize: 100,
    fetchPage: async ({ page, pageSize, search, sort, filters }) => {
      const result = await apiClient.paged2(
        companyId as string,
        page,
        pageSize,
        search,
        [InvoiceDocumentType.SalesReturn],
        undefined,
        filters.state || undefined,
        sort,
        undefined,
      );
      return { items: result.items, total: result.total };
    },
  });
  const returns = paged.items;
  const refetchPaged = paged.query.refetch;

  useEffect(() => {
    if (!companyId) return;
    const missing = returns.filter((invoice) => invoice.state === "Posted" && !(invoice.id in balances));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (invoice) => [invoice.id, await apiClient.balance2(companyId, invoice.id)] as const)).then((entries) => {
      if (!cancelled) setBalances((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, returns]);

  useEffect(() => {
    if (!companyId) return;
    const missing = [...new Set(returns.map((invoice) => invoice.originalInvoiceId).filter((id): id is string => !!id && !(id in originalNumbers)))];
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (id) => [id, (await apiClient.invoicesGET(companyId, id)).invoiceNumber ?? id] as const))
      .then((entries) => {
        if (!cancelled) setOriginalNumbers((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, returns]);

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
          return row.originalInvoiceId ? (originalNumbers[row.originalInvoiceId] ?? "...") : "-";
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
    [intl, partners, originalNumbers, balances],
  );
  const visibleColumns = useMemo(
    () => serverSideColumns(columns, ["invoiceNumber", "customer", "issueDate", "state"], ["state"]),
    [columns],
  );

  const handleCreated = useCallback(async () => {
    setFormOpen(false);
    setFormKey((k) => k + 1);
    await refresh();
    await refetchPaged();
  }, [refresh, refetchPaged]);

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
            columns={visibleColumns}
            data={returns}
            rowCount={paged.total}
            isLoading={paged.query.isPending}
            getRowId={(row) => row.id}
            getRowClassName={(row) => getDocumentRowClassName(row.state)}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "salesReturns.noReturns" })}
            exportFileName="sales-returns"
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
