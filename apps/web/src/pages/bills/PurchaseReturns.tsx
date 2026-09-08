import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { BillResponse, DocumentBalanceResponse, PartnerResponse, PaymentMethodResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { BillDocumentType } from "@/lib/document-types";
import { taxesForPurchase } from "@/lib/tax-enums";
import { BillForm } from "@/pages/bills/BillForm";

// A6 (v2 release): AP mirror of SalesReturns.tsx — form fixed to PurchaseReturn with a required
// original-bill picker, table only ever shows PurchaseReturn rows.
export function PurchaseReturns() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [bills, setBills] = useState<BillResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, billsResult, taxesResult, paymentMethodsResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.billsAll(companyId),
        apiClient.taxes(companyId),
        apiClient.paymentMethodsAll(companyId),
      ]);
      setPartners(partnersResult);
      setBills(billsResult);
      setTaxes(taxesResult);
      setPaymentMethods(paymentMethodsResult);

      const returns = billsResult.filter((bill) => bill.documentType === BillDocumentType.PurchaseReturn);
      const balanceEntries = await Promise.all(
        returns.map(async (bill) => [bill.id, await apiClient.balance(companyId, bill.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "purchaseReturns.loadError" })));
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const vendors = partners.filter((p) => p.isVendor);
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? id;
  const returns = bills.filter((bill) => bill.documentType === BillDocumentType.PurchaseReturn);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "purchaseReturns.newReturn" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "purchaseReturns.newReturnDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <BillForm
            companyId={activeCompany.id}
            vendors={vendors}
            taxes={taxesForPurchase(taxes)}
            bills={bills}
            paymentMethods={paymentMethods}
            isVatRegistered={activeCompany.isVatRegistered}
            onCreated={refresh}
            fixedDocumentType={BillDocumentType.PurchaseReturn}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "purchaseReturns.returnsTable" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "bills.vendorInvoiceNumber" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "common.vendor" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "purchaseReturns.originalBill" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoicing.issueDate" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "invoicing.state" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "purchaseReturns.returnedAmount" })}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.map((bill) => {
                const original = bills.find((candidate) => candidate.id === bill.originalBillId);
                return (
                  <TableRow key={bill.id}>
                    <TableCell>{bill.vendorReference ?? "-"}</TableCell>
                    <TableCell>{partnerName(bill.partnerId)}</TableCell>
                    <TableCell>{original?.vendorReference ?? bill.originalBillId ?? "-"}</TableCell>
                    <TableCell>{bill.issueDate}</TableCell>
                    <TableCell>
                      <Badge variant={bill.state === "Posted" ? "default" : "secondary"}>{bill.state}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {bill.state === "Posted" ? (balances[bill.id]?.total.toFixed(2) ?? "...") : "-"}
                    </TableCell>
                    <TableCell>
                      <Link className="text-sm font-medium text-primary hover:underline" to={`/bills/${bill.id}`}>
                        {intl.formatMessage({ id: "common.view" })}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {returns.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "purchaseReturns.noReturns" })}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
