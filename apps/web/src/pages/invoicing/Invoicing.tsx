import { useCallback, useEffect, useMemo, useState } from "react";
import { useOptionalDrafts } from "@/context/DraftsContext";
import { useIntl } from "react-intl";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { DocumentBalanceResponse, InvoiceResponse, PartnerResponse } from "@pako/shared";

import { apiClient, API_BASE_URL, authorizedFetch, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { downloadFileResponse } from "@/pages/reports/helpers";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { DocumentFilterBar } from "@/components/data-grid/DocumentFilterBar";
import { useDocumentFilters } from "@/components/data-grid/useDocumentFilters";
import { serverSideColumns, usePagedGrid } from "@/components/data-grid/usePagedGrid";
import { FormDialog } from "@/components/shared/FormDialog";
import { useCompany } from "@/context/CompanyContext";
import { dateToIso } from "@/lib/dates";
import {
  documentStateBadgeVariant,
  getDocumentRowClassName,
  InvoiceDocumentType,
  invoiceDocumentTypeLabel,
  paymentStatus,
  paymentStatusBadgeVariant,
  type PaymentStatus,
} from "@/lib/document-types";
import { PartnerForm } from "@/pages/shared/PartnerForm";

export type InvoiceRegisterScope = "invoice" | "proforma";

const GRID_IDS: Record<InvoiceRegisterScope, string> = { invoice: "invoices", proforma: "proforma" };

export function Invoicing({ scope = "invoice" }: { scope?: InvoiceRegisterScope }) {
  const isProforma = scope === "proforma";
  const GRID_ID = GRID_IDS[scope];
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertMessage, setConvertMessage] = useState<{ text: string; invoiceId: string } | null>(null);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const navigate = useNavigate();
  // docs/POS_PLAN.md P6: older links and bookmarks to /invoicing?salesOrder= / ?delivery= now open
  // the invoice page (/invoicing/new), which reads the same parameters.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (!isProforma && (searchParams.has("salesOrder") || searchParams.has("delivery"))) {
      navigate(`/invoicing/new?${searchParams.toString()}`, { replace: true });
    }
  }, [isProforma, searchParams, navigate]);
  // A resumed invoice draft (DraftsRibbon) opens on the invoice page, where the form restores it.
  const resumeRequest = useOptionalDrafts()?.resumeRequest ?? null;
  useEffect(() => {
    if (!isProforma && resumeRequest?.kind === "invoice") navigate("/invoicing/new");
  }, [isProforma, resumeRequest, navigate]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      setPartners(await apiClient.partnersAll(companyId));

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

  const docFilters = useDocumentFilters(GRID_ID);
  const paged = usePagedGrid<InvoiceResponse>({
    gridId: GRID_ID,
    enabled: !!companyId,
    queryKey: ["invoices-paged", companyId, scope, docFilters.filters],
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
        docFilters.filters.partnerId || undefined,
        docFilters.filters.from || undefined,
        docFilters.filters.to || undefined,
        isProforma ? undefined : docFilters.filters.paymentStatus || undefined,
      );
      return { items: result.items, total: result.total };
    },
  });
  const displayedInvoices = paged.items;

  useEffect(() => {
    if (!companyId || isProforma) return;
    const missing = displayedInvoices.filter((invoice) => invoice.state === "Posted" && !(invoice.id in balances));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const resp = await authorizedFetch(`${API_BASE_URL}/api/companies/${companyId}/invoices/balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(missing.map((i) => i.id)),
      });
      if (!resp.ok || cancelled) return;
      const data = (await resp.json()) as Record<string, DocumentBalanceResponse>;
      setBalances((prev) => ({ ...prev, ...data }));
    })();
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

  async function exportAll() {
    try {
      const file = await apiClient.invoicesExport(
        companyId as string,
        paged.urlState.globalFilter.trim() || undefined,
        documentScopeFilter.documentType,
        documentScopeFilter.excludeDocumentType,
        paged.urlState.columnFilters.state || undefined,
        paged.urlState.sort ? `${paged.urlState.sort.desc ? "-" : ""}${paged.urlState.sort.id}` : undefined,
        docFilters.filters.partnerId || undefined,
        docFilters.filters.from || undefined,
        docFilters.filters.to || undefined,
        isProforma ? undefined : docFilters.filters.paymentStatus || undefined,
      );
      downloadFileResponse(file, "invoices.xlsx");
    } catch (err) {
      toast.error(getApiErrorMessage(err, intl.formatMessage({ id: "dataGrid.exportAllError" })));
    }
  }

  const gridRows = useMemo(() => displayedInvoices.map((row) => (row.id in balances ? { ...row } : row)), [displayedInvoices, balances]);

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
          return <Badge variant={documentStateBadgeVariant(state)}>{state}</Badge>;
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
          return value !== undefined ? value.toFixed(2) : "...";
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
          return value !== undefined ? value.toFixed(2) : "...";
        },
      },
      {
        id: "paymentStatus",
        header: intl.formatMessage({ id: "invoicing.paymentStatus" }),
        enableColumnFilter: false,
        enableSorting: false,
        accessorFn: (row) =>
          row.state === "Posted" && row.documentType !== InvoiceDocumentType.CreditNote
            ? paymentStatus(balances[row.id], row.dueDate, dateToIso(new Date()))
            : undefined,
        cell: ({ getValue, row }) => {
          if (row.original.state !== "Posted" || row.original.documentType === InvoiceDocumentType.CreditNote) return "-";
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

  const handleCustomerCreated = useCallback(async () => {
    setCustomerFormOpen(false);
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

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => navigate(isProforma ? "/proforma/new" : "/invoicing/new")}>
          {intl.formatMessage({ id: isProforma ? "proforma.newProforma" : "invoicing.newInvoice" })}
        </Button>
        <Button variant="outline" onClick={() => setCustomerFormOpen(true)}>
          {intl.formatMessage({ id: "invoicing.addCustomer" })}
        </Button>
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

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: isProforma ? "proforma.proformasTable" : "invoicing.invoices" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentFilterBar controls={docFilters} partners={customers} partnerLabelId="docFilters.customer" showPaymentStatus={!isProforma} />
          <DataGrid
            onExportAll={exportAll}
            gridId={GRID_ID}
            columns={visibleColumns}
            data={gridRows}
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
