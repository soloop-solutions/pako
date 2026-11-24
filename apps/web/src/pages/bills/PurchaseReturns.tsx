import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoneyOr } from "@/lib/amount";
import { DocumentStateBadge } from "@/components/shared/DocumentStateBadge";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { BillResponse, DocumentBalanceResponse, PartnerResponse } from "@pako/shared";

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
import { BillDocumentType, getDocumentRowClassName } from "@/lib/document-types";

const GRID_ID = "purchaseReturns";

// A6 (v2 release): AP mirror of SalesReturns.tsx — form fixed to PurchaseReturn with a required
// original-bill picker, grid only ever shows PurchaseReturn rows.
export function PurchaseReturns() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [originalNumbers, setOriginalNumbers] = useState<Record<string, string>>({});
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      setPartners(await apiClient.partnersAll(companyId));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "purchaseReturns.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const vendors = partners.filter((p) => p.isVendor);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const docFilters = useDocumentFilters(GRID_ID);
  const paged = usePagedGrid<BillResponse>({
    gridId: GRID_ID,
    enabled: !!companyId,
    queryKey: ["purchase-returns-paged", companyId, docFilters.filters],
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
    queryKey: ["purchaseReturns-totals", companyId, totalsFilters],
    enabled: !!companyId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiClient.billListTotals(
        companyId as string,
        totalsFilters.search,
        [BillDocumentType.PurchaseReturn],
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
          return <DocumentStateBadge state={state} />;
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
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <PageHeader
        title={intl.formatMessage({ id: "purchaseReturns.title" })}
        description={intl.formatMessage({ id: "purchaseReturns.description" })}
        newAction={{ label: intl.formatMessage({ id: "purchaseReturns.newReturn" }), onClick: () => navigate("/purchase-returns/new") }}
      />


      <Card className="py-4">
        <CardContent>
          <DocumentFilterBar
            controls={docFilters}
            partners={vendors}
            partnerLabelId="docFilters.vendor"
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
            emptyMessage={intl.formatMessage({ id: "purchaseReturns.noReturns" })}
            exportFileName="purchase-returns"
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
          <ListTotalsBar totals={listTotals.data} isLoading={listTotals.isFetching} showOutstanding={false} />
        </CardContent>
      </Card>
    </div>
  );
}
