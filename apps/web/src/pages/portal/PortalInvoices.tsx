import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { PortalInvoiceSummaryResponse } from "@pako/shared";
import { ArrowLeft } from "lucide-react";
import { useMemo, useRef } from "react";
import { useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router-dom";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useDataGridUrlState } from "@/components/data-grid/useDataGridUrlState";
import { PrintButton } from "@/components/shared/PrintButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDisplayDate } from "@/lib/dates";
import { formatAmount } from "@/lib/payroll-enums";
import { lineColumns } from "@/pages/portal/lineColumns";
import { useRequiredPortalCompanyId } from "@/pages/portal/portal-context";

const GRID_ID = "portalInvoices";

function OpenCell({ open, overdue }: { open: number | undefined; overdue: boolean }) {
  const intl = useIntl();
  if (open == null) return <>—</>;
  if (open === 0) return <Badge variant="outline">{intl.formatMessage({ id: "portal.paid" })}</Badge>;
  return (
    <span className={overdue ? "font-medium text-destructive" : undefined}>
      {formatAmount(open)}
      {overdue && <Badge variant="destructive" className="ml-2">{intl.formatMessage({ id: "portal.overdueBadge" })}</Badge>}
    </span>
  );
}

// The customer's posted documents (invoices, credit notes, returns) with what is still open on each.
export function PortalInvoices() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const navigate = useNavigate();
  const companyId = useRequiredPortalCompanyId();
  const grid = useDataGridUrlState(GRID_ID, 50);
  const query = useQuery({
    queryKey: ["portal", companyId, "invoices", grid.page, grid.pageSize],
    queryFn: () => apiClient.listPortalInvoices(companyId, grid.page, grid.pageSize),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<PortalInvoiceSummaryResponse>[]>(
    () => [
      { accessorKey: "number", header: t("portal.col.number"), enableSorting: false, cell: ({ getValue }) => (getValue() as string | undefined) ?? "—" },
      { accessorKey: "kind", header: t("portal.col.kind"), enableSorting: false, cell: ({ getValue }) => t(`portal.kind.${getValue() as string}`) },
      { accessorKey: "issueDate", header: t("portal.col.date"), enableSorting: false, cell: ({ getValue }) => formatDisplayDate(getValue() as string) },
      { accessorKey: "dueDate", header: t("portal.col.due"), enableSorting: false, cell: ({ getValue }) => formatDisplayDate(getValue() as string) },
      { accessorKey: "gross", header: t("portal.col.total"), enableSorting: false, meta: { numeric: true }, cell: ({ getValue }) => formatAmount(getValue() as number) },
      {
        id: "open", header: t("portal.col.open"), enableSorting: false, meta: { numeric: true },
        cell: ({ row }) => <OpenCell open={row.original.open} overdue={row.original.overdue} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("portal.invoicesTitle")}</h1>
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(query.error, t("portal.loadError"))}</AlertDescription>
        </Alert>
      )}
      <DataGrid
        gridId={GRID_ID}
        columns={columns}
        data={query.data?.items ?? []}
        rowCount={query.data?.total ?? 0}
        isLoading={query.isPending}
        getRowId={(i) => i.id}
        onRowClick={(i) => navigate(`/portal/invoices/${i.id}`)}
        emptyMessage={t("portal.invoicesEmpty")}
      />
    </div>
  );
}

export function PortalInvoiceDetail() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { id } = useParams();
  const companyId = useRequiredPortalCompanyId();
  const printRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ["portal", companyId, "invoice", id],
    queryFn: () => apiClient.getPortalInvoice(companyId, id as string),
    enabled: !!id,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => lineColumns(t), [intl]);
  const invoice = query.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/portal/invoices" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          {t("portal.nav.invoices")}
        </Link>
        {invoice && <PrintButton contentRef={printRef} size="sm" />}
      </div>
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(query.error, t("portal.loadError"))}</AlertDescription>
        </Alert>
      )}
      {invoice && (
        <div ref={printRef} className="flex flex-col gap-4 rounded-lg border bg-card p-6">
          <div className="flex flex-wrap justify-between gap-6">
            <div className="text-sm">
              <p className="text-base font-semibold">{invoice.companyName}</p>
              {invoice.companyAddress && <p>{invoice.companyAddress}</p>}
              {invoice.companyFiscalNumber && <p>{t("portal.fiscalNumber")}: {invoice.companyFiscalNumber}</p>}
              {invoice.companyVatNumber && <p>{t("portal.vatNumber")}: {invoice.companyVatNumber}</p>}
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">
                {t(`portal.kind.${invoice.kind}`)} {invoice.number ?? ""}
              </p>
              <p className="text-sm">{t("portal.col.date")}: {formatDisplayDate(invoice.issueDate)}</p>
              <p className="text-sm">{t("portal.col.due")}: {formatDisplayDate(invoice.dueDate)}</p>
            </div>
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">{t("portal.billedTo")}</p>
            <p className="font-medium">{invoice.partnerName}</p>
            {invoice.partnerAddress && <p>{invoice.partnerAddress}</p>}
            {invoice.partnerFiscalNumber && <p>{t("portal.fiscalNumber")}: {invoice.partnerFiscalNumber}</p>}
          </div>
          <DataGrid
            gridId="portalInvoiceLines"
            columns={columns}
            data={invoice.lines}
            rowCount={invoice.lines.length}
            getRowId={(_, index) => String(index)}
            footerRow={{ label: t("portal.total"), cells: { net: formatAmount(invoice.net), vat: formatAmount(invoice.vat), gross: formatAmount(invoice.gross) } }}
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={200}
            pageSizeOptions={[200]}
          />
          {invoice.open != null && (
            <p className="text-right text-sm" data-testid="portal-invoice-open">
              <span className="text-muted-foreground">{t("portal.col.open")}: </span>
              <OpenCell open={invoice.open} overdue={invoice.overdue} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}
