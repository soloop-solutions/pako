import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { InvoiceResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { InvoiceDocumentType } from "@/lib/document-types";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";

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

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const proformas = invoices.filter((invoice) => invoice.documentType === InvoiceDocumentType.Proforma);

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "invoicing.number" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "common.customer" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoicing.issueDate" })}</TableHead>
                <TableHead />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {proformas.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoiceNumber ?? "-"}</TableCell>
                  <TableCell>{partnerName(invoice.partnerId)}</TableCell>
                  <TableCell>{invoice.issueDate}</TableCell>
                  <TableCell>
                    <Link className="text-sm font-medium text-primary hover:underline" to={`/invoicing/${invoice.id}`}>
                      {intl.formatMessage({ id: "common.view" })}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={convertingId === invoice.id}
                      onClick={() => handleConvert(invoice.id)}
                    >
                      {convertingId === invoice.id
                        ? intl.formatMessage({ id: "proforma.converting" })
                        : intl.formatMessage({ id: "proforma.convert" })}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {proformas.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "proforma.noProformas" })}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
