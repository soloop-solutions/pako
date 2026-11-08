import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { BillResponse, DocumentBalanceResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { serverSideColumns, usePagedGrid } from "@/components/data-grid/usePagedGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { BillDocumentType, documentStateBadgeVariant, getDocumentRowClassName } from "@/lib/document-types";
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
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "purchaseReturns.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const vendors = partners.filter((p) => p.isVendor);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const paged = usePagedGrid<BillResponse>({
    gridId: GRID_ID,
    enabled: !!companyId,
    queryKey: ["purchase-returns-paged", companyId],
    defaultPageSize: 100,
    fetchPage: async ({ page, pageSize, search, sort, filters }) => {
      const result = await apiClient.paged(
        companyId as string,
        page,
        pageSize,
        search,
        [BillDocumentType.PurchaseReturn],
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
    const missing = returns.filter((bill) => bill.state === "Posted" && !(bill.id in balances));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (bill) => [bill.id, await apiClient.balance(companyId, bill.id)] as const)).then((entries) => {
      if (!cancelled) setBalances((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, returns]);

  useEffect(() => {
    if (!companyId) return;
    const missing = [...new Set(returns.map((bill) => bill.originalBillId).filter((id): id is string => !!id && !(id in originalNumbers)))];
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (id) => [id, (await apiClient.billsGET(companyId, id)).vendorReference ?? id] as const))
      .then((entries) => {
        if (!cancelled) setOriginalNumbers((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, returns]);

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
          return row.originalBillId ? (originalNumbers[row.originalBillId] ?? "...") : "-";
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
          <Link className="text-sm font-medium text-primary hover:underline" to={`/purchase-returns/${row.original.id}`}>
            {intl.formatMessage({ id: "common.view" })}
          </Link>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners, originalNumbers, balances],
  );
  const visibleColumns = useMemo(
    () => serverSideColumns(columns, ["vendorReference", "vendor", "issueDate", "state"], ["state"]),
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{intl.formatMessage({ id: "purchaseReturns.title" })}</h2>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "purchaseReturns.description" })}</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          {intl.formatMessage({ id: "purchaseReturns.newReturn" })}
        </Button>
      </div>

      <FormDialog
        open={formOpen}
        onOpenChange={(open) => { if (!open) setFormOpen(false); }}
        title={intl.formatMessage({ id: "purchaseReturns.newReturn" })}
        description={intl.formatMessage({ id: "purchaseReturns.newReturnDescription" })}
        size="full"
      >
        <BillForm
          key={formKey}
          companyId={activeCompany.id}
          vendors={vendors}
          taxes={taxesForPurchase(taxes)}
          paymentMethods={paymentMethods}
          isVatRegistered={activeCompany.isVatRegistered}
          onCreated={handleCreated}
          fixedDocumentType={BillDocumentType.PurchaseReturn}
        />
      </FormDialog>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "purchaseReturns.returnsTable" })}</CardTitle>
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
            emptyMessage={intl.formatMessage({ id: "purchaseReturns.noReturns" })}
            exportFileName="purchase-returns"
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
