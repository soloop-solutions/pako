import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { DocumentBalanceResponse, InvoiceResponse, PartnerResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { InvoiceDocumentType } from "@/lib/document-types";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";

// A6 (v2 release): sales returns get their own nav entry/page rather than being one option in
// the Sales invoices dropdown — the form is fixed to SalesReturn (InvoiceForm's fixedDocumentType
// prop) with a required original-invoice picker, and the table only ever shows SalesReturn rows.
export function SalesReturns() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, invoicesResult, taxesResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.invoicesAll(companyId),
        apiClient.taxes(companyId),
      ]);
      setPartners(partnersResult);
      setInvoices(invoicesResult);
      setTaxes(taxesResult);

      const returns = invoicesResult.filter((invoice) => invoice.documentType === InvoiceDocumentType.SalesReturn);
      const balanceEntries = await Promise.all(
        returns.map(async (invoice) => [invoice.id, await apiClient.balance2(companyId, invoice.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "salesReturns.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const returns = invoices.filter((invoice) => invoice.documentType === InvoiceDocumentType.SalesReturn);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "salesReturns.newReturn" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "salesReturns.newReturnDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <InvoiceForm
            companyId={activeCompany.id}
            customers={customers}
            taxes={taxesForSale(taxes)}
            invoices={invoices}
            onCreated={refresh}
            fixedDocumentType={InvoiceDocumentType.SalesReturn}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "salesReturns.returnsTable" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "invoicing.number" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "common.customer" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "salesReturns.originalInvoice" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoicing.issueDate" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoicing.state" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "salesReturns.returnedAmount" })}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.map((invoice) => {
                const original = invoices.find((candidate) => candidate.id === invoice.originalInvoiceId);
                return (
                  <TableRow key={invoice.id}>
                    <TableCell>{invoice.invoiceNumber ?? "-"}</TableCell>
                    <TableCell>{partnerName(invoice.partnerId)}</TableCell>
                    <TableCell>{original?.invoiceNumber ?? invoice.originalInvoiceId ?? "-"}</TableCell>
                    <TableCell>{invoice.issueDate}</TableCell>
                    <TableCell>
                      <Badge variant={invoice.state === "Posted" ? "default" : "secondary"}>{invoice.state}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {invoice.state === "Posted" ? (balances[invoice.id]?.total.toFixed(2) ?? "...") : "-"}
                    </TableCell>
                    <TableCell>
                      <Link className="text-sm font-medium text-primary hover:underline" to={`/invoicing/${invoice.id}`}>
                        {intl.formatMessage({ id: "common.view" })}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {returns.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "salesReturns.noReturns" })}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
