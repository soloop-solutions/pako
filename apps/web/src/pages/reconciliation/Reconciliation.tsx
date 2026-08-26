import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BillResponse, DocumentBalanceResponse, InvoiceResponse, PartnerResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";

export function Reconciliation() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [bills, setBills] = useState<BillResponse[]>([]);
  const [invoiceBalances, setInvoiceBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [billBalances, setBillBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, invoicesResult, billsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.invoicesAll(companyId),
        apiClient.billsAll(companyId),
      ]);
      setPartners(partnersResult);

      const postedInvoices = invoicesResult.filter((i) => i.state === "Posted");
      const postedBills = billsResult.filter((b) => b.state === "Posted");
      setInvoices(postedInvoices);
      setBills(postedBills);

      const [invoiceBalanceEntries, billBalanceEntries] = await Promise.all([
        Promise.all(postedInvoices.map(async (i) => [i.id, await apiClient.balance2(companyId, i.id)] as const)),
        Promise.all(postedBills.map(async (b) => [b.id, await apiClient.balance(companyId, b.id)] as const)),
      ]);
      setInvoiceBalances(Object.fromEntries(invoiceBalanceEntries));
      setBillBalances(Object.fromEntries(billBalanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load reconciliation data."));
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reconciliation</CardTitle>
          <CardDescription>Match payments against invoices and bills.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select or create a company on the Companies page first.</p>
        </CardContent>
      </Card>
    );
  }

  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const outstandingInvoices = invoices.filter((i) => (invoiceBalances[i.id]?.outstanding ?? 0) > 0);
  const outstandingBills = bills.filter((b) => (billBalances[b.id]?.outstanding ?? 0) > 0);
  const totalAr = outstandingInvoices.reduce((sum, i) => sum + (invoiceBalances[i.id]?.outstanding ?? 0), 0);
  const totalAp = outstandingBills.reduce((sum, b) => sum + (billBalances[b.id]?.outstanding ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <CardDescription className="text-sm text-muted-foreground">
        Outstanding invoices and bills. Record payments from an invoice's or bill's own detail page.
      </CardDescription>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Accounts receivable</CardTitle>
          <CardDescription>Total outstanding: {totalAr.toFixed(2)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {outstandingInvoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoiceNumber ?? "-"}</TableCell>
                  <TableCell>{partnerName(invoice.partnerId)}</TableCell>
                  <TableCell>{invoice.dueDate}</TableCell>
                  <TableCell className="text-right">{invoiceBalances[invoice.id]?.outstanding.toFixed(2)}</TableCell>
                  <TableCell>
                    <Link className="text-sm font-medium text-primary hover:underline" to={`/invoicing/${invoice.id}`}>
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {outstandingInvoices.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">No outstanding invoices.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts payable</CardTitle>
          <CardDescription>Total outstanding: {totalAp.toFixed(2)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor reference</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {outstandingBills.map((bill) => (
                <TableRow key={bill.id}>
                  <TableCell>{bill.vendorReference ?? "-"}</TableCell>
                  <TableCell>{partnerName(bill.partnerId)}</TableCell>
                  <TableCell>{bill.dueDate}</TableCell>
                  <TableCell className="text-right">{billBalances[bill.id]?.outstanding.toFixed(2)}</TableCell>
                  <TableCell>
                    <Link className="text-sm font-medium text-primary hover:underline" to={`/bills/${bill.id}`}>
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {outstandingBills.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No outstanding bills.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
