import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  AccountResponse,
  BillResponse,
  DocumentBalanceResponse,
  JournalResponse,
  PartnerResponse,
  TaxDefinitionResponse,
} from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { isCashOrBankAccountSubType } from "@/lib/ledger-enums";
import { estimatedTaxAmount } from "@/lib/tax-enums";
import { RecordPaymentForm } from "@/pages/shared/RecordPaymentForm";

const ACCOUNTS_PAYABLE_CODE = "2000";

export function BillDetail() {
  const { id } = useParams<{ id: string }>();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [bill, setBill] = useState<BillResponse | null>(null);
  const [partners, setPartners] = useState<PartnerResponse[]>([]);
  const [taxes, setTaxes] = useState<TaxDefinitionResponse[]>([]);
  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [journals, setJournals] = useState<JournalResponse[]>([]);
  const [balance, setBalance] = useState<DocumentBalanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyId || !id) return;
    setError(null);
    try {
      const [billResult, partnersResult, taxesResult, accountsResult, journalsResult] = await Promise.all([
        apiClient.billsGET(companyId, id),
        apiClient.partnersAll(companyId),
        apiClient.taxes(companyId),
        apiClient.accounts(companyId),
        apiClient.journalsAll(companyId),
      ]);
      setBill(billResult);
      setPartners(partnersResult);
      setTaxes(taxesResult);
      setAccounts(accountsResult);
      setJournals(journalsResult);

      if (billResult.state === "Posted") {
        setBalance(await apiClient.balance(companyId, id));
      } else {
        setBalance(null);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load the bill."));
    }
  }, [companyId, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handlePost() {
    if (!companyId || !id) return;
    setPostError(null);
    setPosting(true);
    try {
      await apiClient.post(companyId, id);
      await refresh();
    } catch (err) {
      setPostError(getApiErrorMessage(err, "Could not post this bill."));
    } finally {
      setPosting(false);
    }
  }

  if (!activeCompany || !bill) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bill</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const partner = partners.find((p) => p.id === bill.partnerId);
  const controlAccount = accounts.find((a) => a.code === ACCOUNTS_PAYABLE_CODE);
  const cashAccounts = accounts.filter((a) => isCashOrBankAccountSubType(a.accountSubType));
  const generalJournal = journals.find((j) => j.code === "GEN") ?? journals[0];

  let subtotal = 0;
  let estimatedTax = 0;
  for (const line of bill.lines) {
    const net = line.quantity * line.unitPrice;
    subtotal += net;
    estimatedTax += estimatedTaxAmount(net, taxes.find((t) => t.id === line.taxDefinitionId));
  }

  return (
    <div className="flex flex-col gap-6">
      <Link className="text-sm text-muted-foreground hover:underline" to="/bills">
        &larr; Back to bills
      </Link>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{bill.vendorReference ?? "Draft bill"}</CardTitle>
              <CardDescription>{partner?.name ?? bill.partnerId}</CardDescription>
            </div>
            <Badge variant={bill.state === "Posted" ? "default" : "secondary"}>{bill.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Issue date:</span> {bill.issueDate}
            </p>
            <p>
              <span className="text-muted-foreground">Due date:</span> {bill.dueDate}
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead>Tax</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">{line.unitPrice.toFixed(2)}</TableCell>
                  <TableCell>{taxes.find((t) => t.id === line.taxDefinitionId)?.name ?? "-"}</TableCell>
                  <TableCell className="text-right">{(line.quantity * line.unitPrice).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-col items-end gap-1 text-sm">
            <p>Subtotal: {subtotal.toFixed(2)}</p>
            <p>Estimated tax: {estimatedTax.toFixed(2)}</p>
            <p className="font-medium">Estimated total: {(subtotal + estimatedTax).toFixed(2)}</p>
          </div>

          {bill.state === "Draft" && (
            <div className="flex flex-col items-start gap-1">
              <Button onClick={handlePost} disabled={posting}>
                {posting ? "Posting..." : "Post bill"}
              </Button>
              {postError && <span className="text-xs text-destructive">{postError}</span>}
            </div>
          )}

          {bill.state === "Posted" && balance && (
            <div className="flex gap-6 text-sm">
              <p>Total: {balance.total.toFixed(2)}</p>
              <p>Reconciled: {balance.reconciled.toFixed(2)}</p>
              <p className="font-medium">Outstanding: {balance.outstanding.toFixed(2)}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {bill.state === "Posted" && balance && balance.outstanding > 0 && controlAccount && generalJournal && (
        <Card>
          <CardHeader>
            <CardTitle>Record payment</CardTitle>
            <CardDescription>Creates and posts the settlement entry, then reconciles it against this bill.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecordPaymentForm
              companyId={activeCompany.id}
              documentKind="bill"
              documentId={bill.id}
              partnerId={bill.partnerId}
              controlAccountId={controlAccount.id}
              journalId={generalJournal.id}
              cashAccounts={cashAccounts}
              outstanding={balance.outstanding}
              onRecorded={refresh}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
