import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { InvoiceResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useCompany } from "@/context/CompanyContext";
import { InvoiceDocumentType } from "@/lib/document-types";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";

const GRID_ID = "proforma";

// A3/A6 (v2 release): a proforma is an offer, not a legal invoice — it never posts, so this page
// is purely list + create + "Convert to invoice" (no Post action anywhere). The create form is
// fixed to Proforma with no original-document picker (a proforma isn't a correction of anything).
export function Proforma() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertMessage, setConvertMessage] = useState<{ text: string; invoiceId: string } | null>(null);

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
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "proforma.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "proforma.convertError" })));
    } finally {
      setConvertingId(null);
    }
  }

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const proformas = useMemo(
    () => invoices.filter((invoice) => invoice.documentType === InvoiceDocumentType.Proforma),
    [invoices],
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
        accessorKey: "issueDate",
        header: intl.formatMessage({ id: "invoicing.issueDate" }),
      },
      {
        id: "view",
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
      {
        id: "convert",
        header: "",
        enableSorting: false,
        enableColumnFilter: false,
        enableGrouping: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={convertingId === row.original.id}
            onClick={() => handleConvert(row.original.id)}
          >
            {convertingId === row.original.id
              ? intl.formatMessage({ id: "proforma.converting" })
              : intl.formatMessage({ id: "proforma.convert" })}
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intl, partners, convertingId],
  );

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "proforma.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "proforma.description" })}</CardDescription>
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

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "proforma.newProforma" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "proforma.newProformaDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <InvoiceForm
            companyId={activeCompany.id}
            customers={customers}
            taxes={taxesForSale(taxes)}
            invoices={invoices}
            paymentMethods={paymentMethods}
            isVatRegistered={activeCompany.isVatRegistered}
            onCreated={refresh}
            fixedDocumentType={InvoiceDocumentType.Proforma}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "proforma.proformasTable" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={GRID_ID}
            columns={columns}
            data={proformas}
            rowCount={proformas.length}
            getRowId={(row) => row.id}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "proforma.noProformas" })}
            exportFileName="proforma"
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
