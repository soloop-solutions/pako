import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoneyOr } from "@/lib/amount";
import { DocumentStateBadge } from "@/components/shared/DocumentStateBadge";
import { useOptionalDrafts } from "@/context/DraftsContext";
import { PageHeader } from "@/components/list/PageHeader";
import { ListTotalsBar } from "@/components/list/ListTotalsBar";
import { useListRibbonOptions } from "@/hooks/useListRibbonOptions";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { Link, useNavigate } from "react-router-dom";
import { CircleDollarSign, ExternalLink, Send } from "lucide-react";
import { RowActionButton } from "@/components/list/DocumentActions";
import { reportBulk, runEach } from "@/components/list/bulk-actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-context";
import { useMyAccess } from "@/hooks/useMyAccess";
import { entityPath } from "@/lib/entityLinks";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  BillResponse,
  DocumentBalanceResponse,
  PartnerResponse,
} from "@pako/shared";

import { apiClient, API_BASE_URL, authorizedFetch, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { downloadFileResponse } from "@/pages/reports/helpers";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { DocumentFilterBar } from "@/components/data-grid/DocumentFilterBar";
import { useDocumentFilters } from "@/components/data-grid/useDocumentFilters";
import { serverSideColumns, usePagedGrid } from "@/components/data-grid/usePagedGrid";
import { useCompany } from "@/context/CompanyContext";
import { dateToIso } from "@/lib/dates";
import {
  BillDocumentType,
  billDocumentTypeLabel,
  getDocumentRowClassName,
  paymentStatus,
  paymentStatusBadgeVariant,
  type PaymentStatus,
} from "@/lib/document-types";

const GRID_ID = "bills";

export function Bills() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  // User decision 2026-11-24: a bill is entered on its own page (/bills/new), as invoices are.
  const resumeRequest = useOptionalDrafts()?.resumeRequest ?? null;

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      setPartners(await apiClient.partnersAll(companyId));

    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "bills.loadError" })));
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
    queryKey: ["bills-paged", companyId, docFilters.filters],
    defaultPageSize: 100,
    fetchPage: async ({ page, pageSize, search, sort, filters }) => {
      const result = await apiClient.paged(companyId as string, page, pageSize, search, undefined, [BillDocumentType.PurchaseReturn], filters.state || undefined, sort, docFilters.filters.partnerId || undefined, docFilters.filters.from || undefined, docFilters.filters.to || undefined, docFilters.filters.paymentStatus || undefined,
        docFilters.filters.warehouseId || undefined, docFilters.filters.createdById || undefined);
      return { items: result.items, total: result.total };
    },
  });
  const displayedBills = paged.items;

  // Client request 2026-11-24: row and bulk actions. Post goes through the same endpoint as the bill
  // page, one bill at a time; Pay opens the bill, where the payment is recorded. Bills have no PDF.
  const navigate = useNavigate();
  useEffect(() => {
    if (resumeRequest?.kind === "bill") navigate("/bills/new");
  }, [resumeRequest, navigate]);
  const confirm = useConfirm();
  const { canApprove, canWrite } = useMyAccess();
  const mayPost = canApprove("purchases");
  const [bulkBusy, setBulkBusy] = useState(false);
  const label = (bill: BillResponse) => bill.vendorReference || bill.id.slice(0, 8);

  function postBills(bills: BillResponse[], done?: () => void) {
    const drafts = bills.filter((b) => b.state === "Draft");
    if (!companyId || drafts.length === 0) return;
    confirm(intl.formatMessage({ id: "listActions.postConfirm" }, { count: drafts.length }), () => {
      setBulkBusy(true);
      void runEach(drafts, (b) => apiClient.post(companyId, b.id), label, intl.formatMessage({ id: "billDetail.postError" }))
        .then((result) => {
          reportBulk(intl, result, "listActions.posted");
          done?.();
          void paged.query.refetch();
          void listTotals.refetch();
        })
        .finally(() => setBulkBusy(false));
    });
  }

  const rowActions = (bill: BillResponse) => (
    <>
      <RowActionButton label={intl.formatMessage({ id: "listActions.open" })} icon={ExternalLink}
        onClick={() => navigate(entityPath({ kind: "Bill", id: bill.id }) ?? "/bills")} />
      {mayPost && bill.state === "Draft" && (
        <RowActionButton label={intl.formatMessage({ id: "listActions.post" })} icon={Send} disabled={bulkBusy} onClick={() => postBills([bill])} />
      )}
      {bill.state === "Posted" && (balances[bill.id]?.outstanding ?? 0) > 0 && mayPost && (
        <RowActionButton label={intl.formatMessage({ id: "listActions.pay" })} icon={CircleDollarSign}
          onClick={() => navigate(`${entityPath({ kind: "Bill", id: bill.id }) ?? "/bills"}#payment`)} />
      )}
    </>
  );

  const bulkActions = (selected: BillResponse[], clear: () => void) =>
    mayPost ? (
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={bulkBusy || !selected.some((b) => b.state === "Draft")}
        onClick={() => postBills(selected, clear)}>
        {intl.formatMessage({ id: "listActions.postSelected" })}
      </Button>
    ) : null;

  // The totals under the list: same filters as the grid, every page (client request 2026-11-24).
  const totalsFilters = {
    search: paged.urlState.globalFilter.trim() || undefined,
    state: paged.urlState.columnFilters.state || undefined,
    ...docFilters.filters,
  };
  const listTotals = useQuery({
    queryKey: ["bills-totals", companyId, totalsFilters],
    enabled: !!companyId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiClient.billListTotals(
        companyId as string,
        totalsFilters.search,
        undefined,
        [BillDocumentType.PurchaseReturn],
        totalsFilters.state,
        docFilters.filters.partnerId || undefined,
        docFilters.filters.from || undefined,
        docFilters.filters.to || undefined,
        docFilters.filters.paymentStatus || undefined,
        docFilters.filters.warehouseId || undefined,
        docFilters.filters.createdById || undefined,
      ),
  });
  const ribbonOptions = useListRibbonOptions();

  useEffect(() => {
    if (!companyId) return;
    const missing = displayedBills.filter((bill) => bill.state === "Posted" && !(bill.id in balances));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const resp = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/bills/balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(missing.map((b) => b.id)),
      });
      if (!resp.ok || cancelled) return;
      const data = (await resp.json()) as Record<string, DocumentBalanceResponse>;
      setBalances((prev) => ({ ...prev, ...data }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, displayedBills]);

  async function exportAll() {
    try {
      const file = await apiClient.billsExport(
        companyId as string,
        paged.urlState.globalFilter.trim() || undefined,
        undefined,
        [BillDocumentType.PurchaseReturn],
        paged.urlState.columnFilters.state || undefined,
        paged.urlState.sort ? `${paged.urlState.sort.desc ? "-" : ""}${paged.urlState.sort.id}` : undefined,
        docFilters.filters.partnerId || undefined,
        docFilters.filters.from || undefined,
        docFilters.filters.to || undefined,
        docFilters.filters.paymentStatus || undefined,
        docFilters.filters.warehouseId || undefined,
        docFilters.filters.createdById || undefined,
      );
      downloadFileResponse(file, "bills.xlsx");
    } catch (err) {
      toast.error(getApiErrorMessage(err, intl.formatMessage({ id: "dataGrid.exportAllError" })));
    }
  }

  const gridRows = useMemo(() => displayedBills.map((row) => (row.id in balances ? { ...row } : row)), [displayedBills, balances]);

  const columns = useMemo<ColumnDef<BillResponse>[]>(
    () => [
      {
        accessorKey: "vendorReference",
        header: intl.formatMessage({ id: "bills.vendorInvoiceNumber" }),
        cell: ({ getValue }) => (getValue() as string | undefined) ?? "-",
      },
      {
        id: "type",
        header: intl.formatMessage({ id: "common.type" }),
        accessorFn: (row) => billDocumentTypeLabel(row.documentType, intl),
        enableSorting: false,
        cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
      },
      {
        id: "vendor",
        header: intl.formatMessage({ id: "common.vendor" }),
        accessorFn: (row) => row.partnerName ?? partnerName(row.partnerId),
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
          return <DocumentStateBadge state={state} />;
        },
      },
      {
        id: "createdBy",
        header: intl.formatMessage({ id: "invoicing.createdBy" }),
        accessorFn: (row) => row.createdByName ?? "",
        cell: ({ getValue }) => (getValue() as string) || "-",
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
          return formatMoneyOr(value, "...");
        },
      },
      {
        id: "paid",
        header: intl.formatMessage({ id: "invoicing.paid" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        enableSorting: false,
        accessorFn: (row) => (row.state === "Posted" ? balances[row.id]?.reconciled : undefined),
        cell: ({ getValue, row }) => {
          const value = getValue() as number | undefined;
          if (row.original.state !== "Posted") return "-";
          return formatMoneyOr(value, "...");
        },
      },
      {
        id: "paymentStatus",
        header: intl.formatMessage({ id: "invoicing.paymentStatus" }),
        enableColumnFilter: false,
        enableSorting: false,
        accessorFn: (row) =>
          row.state === "Posted" && row.documentType !== BillDocumentType.CreditNote
            ? paymentStatus(balances[row.id], row.dueDate, dateToIso(new Date()))
            : undefined,
        cell: ({ getValue, row }) => {
          if (row.original.state !== "Posted" || row.original.documentType === BillDocumentType.CreditNote) return "-";
          const status = getValue() as PaymentStatus | undefined;
          if (!status) return "...";
          return <Badge variant={paymentStatusBadgeVariant(status)}>{intl.formatMessage({ id: `invoicing.paymentStatus.${status}` })}</Badge>;
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
    [intl, partners, balances],
  );
  const visibleColumns = useMemo(() => serverSideColumns(columns, ["vendorReference", "vendor", "issueDate", "dueDate", "state"], ["state"]), [columns]);




  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "bills.title" })}</CardTitle>
        </CardHeader>
        <p className="p-6 text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
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
        title={intl.formatMessage({ id: "bills.title" })}
        description={intl.formatMessage({ id: "bills.description" })}
        newAction={{ label: intl.formatMessage({ id: "bills.newBill" }), onClick: () => navigate("/bills/new") }}
      />


      <Card className="py-4">
        <CardContent>
          <DocumentFilterBar
            controls={docFilters}
            partners={vendors}
            partnerLabelId="docFilters.vendor"
            showPaymentStatus
            warehouses={ribbonOptions.warehouses}
            users={ribbonOptions.users}
          />
          <DataGrid
            onExportAll={exportAll}
            gridId={GRID_ID}
            columns={visibleColumns}
            data={gridRows}
            rowCount={paged.total}
            isLoading={paged.query.isPending}
            getRowId={(row) => row.id}
            getRowClassName={(row) => getDocumentRowClassName(row.state)}
            enableRowSelection
            rowActions={rowActions}
            bulkActions={bulkActions}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "bills.noBills" })}
            emptyAction={canWrite("purchases") && docFilters.activeCount === 0 && !paged.urlState.globalFilter.trim() ? (
              <Button type="button" size="sm" onClick={() => navigate("/bills/new")}>
                {intl.formatMessage({ id: "bills.newBill" })}
              </Button>
            ) : undefined}
            exportFileName="bills"
            defaultPageSize={100}
            pageSizeOptions={[50, 100, 200]}
          />
          <ListTotalsBar totals={listTotals.data} isLoading={listTotals.isFetching} />
        </CardContent>
      </Card>
    </div>
  );
}
