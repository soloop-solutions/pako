import { useCallback, useEffect, useState } from "react";
import type { AccountResponse, JournalEntryResponse, JournalResponse, TrialBalanceLine } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { accountSubTypeLabel, accountTypeLabel } from "@/lib/ledger-enums";
import { JournalEntriesTable } from "@/pages/ledger/JournalEntriesTable";
import { JournalEntryForm } from "@/pages/ledger/JournalEntryForm";

export function Ledger() {
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [journals, setJournals] = useState<JournalResponse[]>([]);
  const [entries, setEntries] = useState<JournalEntryResponse[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [accountsResult, journalsResult, entriesResult, trialBalanceResult] = await Promise.all([
        apiClient.accounts(companyId),
        apiClient.journalsAll(companyId),
        apiClient.journalEntriesAll(companyId),
        apiClient.trialBalance(companyId),
      ]);
      setAccounts(accountsResult);
      setJournals(journalsResult);
      setEntries(entriesResult);
      setTrialBalance(trialBalanceResult);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load the ledger."));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ledger</CardTitle>
          <CardDescription>Chart of accounts, journals, and journal entries.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select or create a company on the Companies page first.</p>
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

      <Card>
        <CardHeader>
          <CardTitle>Chart of accounts</CardTitle>
          <CardDescription>{activeCompany.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Sub-type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>{account.code}</TableCell>
                  <TableCell>{account.name}</TableCell>
                  <TableCell>{accountTypeLabel(account.accountType)}</TableCell>
                  <TableCell>{accountSubTypeLabel(account.accountSubType)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && accounts.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No accounts found.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New journal entry</CardTitle>
          <CardDescription>Debits must equal credits before it can be posted.</CardDescription>
        </CardHeader>
        <CardContent>
          <JournalEntryForm companyId={activeCompany.id} journals={journals} accounts={accounts} onCreated={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Journal entries</CardTitle>
        </CardHeader>
        <CardContent>
          <JournalEntriesTable companyId={activeCompany.id} entries={entries} journals={journals} onPosted={refresh} />
          {!loading && entries.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No journal entries yet.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trial balance</CardTitle>
          <CardDescription>Posted entries only.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trialBalance.map((line) => (
                <TableRow key={line.accountId}>
                  <TableCell>{line.accountCode}</TableCell>
                  <TableCell>{line.accountName}</TableCell>
                  <TableCell className="text-right">{line.debit.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.credit.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.balance.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && trialBalance.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">No posted entries yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
