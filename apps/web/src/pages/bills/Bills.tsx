import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BillResponse, DocumentBalanceResponse, PartnerResponse, TaxDefinitionResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { taxesForPurchase } from "@/lib/tax-enums";
import { BillForm } from "@/pages/bills/BillForm";
import { PartnerForm } from "@/pages/shared/PartnerForm";

export function Bills() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [bills, setBills] = useState<BillResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [balances, setBalances] = useState<Record<string, DocumentBalanceResponse>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [partnersResult, billsResult, taxesResult] = await Promise.all([
        apiClient.partnersAll(companyId),
        apiClient.billsAll(companyId),
        apiClient.taxes(companyId),
      ]);
      setPartners(partnersResult);
      setBills(billsResult);
      setTaxes(taxesResult);

      const balanceEntries = await Promise.all(
        billsResult.map(async (bill) => [bill.id, await apiClient.balance(companyId, bill.id)] as const),
      );
      setBalances(Object.fromEntries(balanceEntries));
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load bills data."));
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bills</CardTitle>
          <CardDescription>Vendor bills (accounts payable).</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select or create a company on the Companies page first.</p>
        </CardContent>
      </Card>
    );
  }

  const vendors = partners.filter((p) => p.isVendor);
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
          <CardTitle>Vendors</CardTitle>
          <CardDescription>{activeCompany.name}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PartnerForm companyId={activeCompany.id} role="vendor" onCreated={refresh} />
          {vendors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vendors yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {vendors.map((vendor) => (
                <Badge key={vendor.id} variant="secondary">
                  {vendor.name}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New bill</CardTitle>
          <CardDescription>Tax is computed by the server when the bill is posted.</CardDescription>
        </CardHeader>
        <CardContent>
          <BillForm companyId={activeCompany.id} vendors={vendors} taxes={taxesForPurchase(taxes)} onCreated={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bills</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor reference</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Issue date</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((bill) => (
                <TableRow key={bill.id}>
                  <TableCell>{bill.vendorReference ?? "-"}</TableCell>
                  <TableCell>{partnerName(bill.partnerId)}</TableCell>
                  <TableCell>{bill.issueDate}</TableCell>
                  <TableCell>{bill.dueDate}</TableCell>
                  <TableCell>
                    <Badge variant={bill.state === "Posted" ? "default" : "secondary"}>{bill.state}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {bill.state === "Posted" ? (balances[bill.id]?.outstanding.toFixed(2) ?? "...") : "-"}
                  </TableCell>
                  <TableCell>
                    <Link className="text-sm font-medium text-primary hover:underline" to={`/bills/${bill.id}`}>
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {bills.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No bills yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
