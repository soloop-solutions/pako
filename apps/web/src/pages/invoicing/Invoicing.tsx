import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DocumentBalanceResponse, InvoiceResponse, PartnerResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { taxesForSale } from "@/lib/tax-enums";
import { InvoiceForm } from "@/pages/invoicing/InvoiceForm";
import { PartnerForm } from "@/pages/shared/PartnerForm";

export function Invoicing() {
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

      const balanceEntries = await Promise.all(
        invoicesResult.map(async (invoice) => [invoice.id, await apiClient.balance2(companyId, invoice.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load invoicing data."));
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invoicing</CardTitle>
          <CardDescription>Customer invoices (accounts receivable).</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select or create a company on the Companies page first.</p>
        </CardContent>
      </Card>
    );
  }

  const customers = partners.filter((p) => p.isCustomer);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Customers</CardTitle>
          <CardDescription>{activeCompany.name}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PartnerForm companyId={activeCompany.id} role="customer" onCreated={refresh} />
          {customers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No customers yet.</p>
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
          <CardTitle>New invoice</CardTitle>
          <CardDescription>Tax is computed by the server when the invoice is posted.</CardDescription>
        </CardHeader>
        <CardContent>
          <InvoiceForm companyId={activeCompany.id} customers={customers} taxes={taxesForSale(taxes)} onCreated={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Issue date</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoiceNumber ?? "-"}</TableCell>
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
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {invoices.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No invoices yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
