import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { DocumentBalanceResponse, InvoiceResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { InvoiceDocumentType, invoiceDocumentTypeLabel } from "@/lib/document-types";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";
import { PartnerForm } from "@/pages/shared/PartnerForm";

export function Invoicing() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);

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

      const balanceEntries = await Promise.all(
        invoicesResult.map(async (invoice) => [invoice.id, await apiClient.balance2(companyId, invoice.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "invoicing.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "invoicing.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "invoicing.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
        </CardContent>
      </Card>
    );
  }

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  // A6 (v2 release): Sales returns and Proforma now have their own pages — this table stays
  // scoped to what this page's create form can actually produce (Invoice/CreditNote/DebitNote/
  // DownPayment). The full `invoices` array (unfiltered) still passes through to InvoiceForm so
  // its original-invoice picker for CreditNote/DebitNote is unaffected.
  const displayedInvoices = invoices.filter(
    (invoice) => invoice.documentType !== InvoiceDocumentType.SalesReturn && invoice.documentType !== InvoiceDocumentType.Proforma,
  );

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "invoicing.customers" })}</CardTitle>
          <CardDescription>{activeCompany.name}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PartnerForm companyId={activeCompany.id} role="customer" onCreated={refresh} />
          {customers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "invoicing.noCustomers" })}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {customers.map((customer) => (
                <Badge key={customer.id} variant="secondary">
                  {customer.name}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "invoicing.newInvoice" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "invoicing.newInvoiceDescription" })}</CardDescription>
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
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "invoicing.invoices" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "invoicing.number" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "common.type" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "common.customer" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoicing.issueDate" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoicing.dueDate" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoicing.state" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "invoicing.outstanding" })}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedInvoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoiceNumber ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{invoiceDocumentTypeLabel(invoice.documentType, intl)}</Badge>
                  </TableCell>
                  <TableCell>{partnerName(invoice.partnerId)}</TableCell>
                  <TableCell>{invoice.issueDate}</TableCell>
                  <TableCell>{invoice.dueDate}</TableCell>
                  <TableCell>
                    <Badge variant={invoice.state === "Posted" ? "default" : "secondary"}>{invoice.state}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {invoice.state === "Posted" ? (balances[invoice.id]?.outstanding.toFixed(2) ?? "...") : "-"}
                  </TableCell>
                  <TableCell>
                    <Link className="text-sm font-medium text-primary hover:underline" to={`/invoicing/${invoice.id}`}>
                      {intl.formatMessage({ id: "common.view" })}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {displayedInvoices.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "invoicing.noInvoices" })}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
