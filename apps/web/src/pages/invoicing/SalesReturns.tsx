import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoneyOr } from "@/lib/amount";
import { DocumentStateBadge } from "@/components/shared/DocumentStateBadge";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { DocumentBalanceResponse, InvoiceResponse, PartnerResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { serverSideColumns, usePagedGrid } from "@/components/data-grid/usePagedGrid";
import { DocumentFilterBar } from "@/components/data-grid/DocumentFilterBar";
import { useDocumentFilters } from "@/components/data-grid/useDocumentFilters";
import { PageHeader } from "@/components/list/PageHeader";
import { ListTotalsBar } from "@/components/list/ListTotalsBar";
import { useListRibbonOptions } from "@/hooks/useListRibbonOptions";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { getDocumentRowClassName, InvoiceDocumentType } from "@/lib/document-types";

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
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      setPartners(await apiClient.partnersAll(companyId));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "salesReturns.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const docFilters = useDocumentFilters(GRID_ID);
  const paged = usePagedGrid<InvoiceResponse>({
    gridId: GRID_ID,
    enabled: !!companyId,
    queryKey: ["sales-returns-paged", companyId, docFilters.filters],
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
        docFilters.filters.partnerId || undefined,
        docFilters.filters.from || undefined,
        docFilters.filters.to || undefined,
        undefined,
        docFilters.filters.warehouseId || undefined,
        docFilters.filters.createdById || undefined,
      );
      return { items: result.items, total: result.total };
    },
  });
  // The totals under the list: same filters as the grid, every page (client request 2026-11-24).
  const totalsFilters = {
    search: paged.urlState.globalFilter.trim() || undefined,
    state: paged.urlState.columnFilters.state || undefined,
    ...docFilters.filters,
  };
  const listTotals = useQuery({
    queryKey: ["salesReturns-totals", companyId, totalsFilters],
    enabled: !!companyId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiClient.invoiceListTotals(
        companyId as string,
        totalsFilters.search,
        [InvoiceDocumentType.SalesReturn],
        undefined,
        totalsFilters.state,
        docFilters.filters.partnerId || undefined,
        docFilters.filters.from || undefined,
        docFilters.filters.to || undefined,
        undefined,
        docFilters.filters.warehouseId || undefined,
        docFilters.filters.createdById || undefined,
      ),
  });
  const ribbonOptions = useListRibbonOptions();
  const returns = useMemo(
    () => [...paged.items],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paged.items, balances, originalNumbers],
  );

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
          return <DocumentStateBadge state={state} />;
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
          return formatMoneyOr(value, "...");
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

      <PageHeader
        title={intl.formatMessage({ id: "salesReturns.title" })}
        description={intl.formatMessage({ id: "salesReturns.description" })}
        newAction={{ label: intl.formatMessage({ id: "salesReturns.newReturn" }), onClick: () => navigate("/sales-returns/new") }}
      />

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "salesReturns.returnsTable" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentFilterBar
            controls={docFilters}
            partners={partners.filter((p) => p.isCustomer)}
            partnerLabelId="docFilters.customer"
            showPaymentStatus={false}
            warehouses={ribbonOptions.warehouses}
            users={ribbonOptions.users}
          />
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
          <ListTotalsBar totals={listTotals.data} isLoading={listTotals.isFetching} showOutstanding={false} />
        </CardContent>
      </Card>
    </div>
  );
}
