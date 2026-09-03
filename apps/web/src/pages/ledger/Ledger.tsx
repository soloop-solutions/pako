import { useCallback, useEffect, useState } from "react";
import { useIntl } from "react-intl";
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
  const intl = useIntl();
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
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "ledger.loadError" })));
    } finally {
      setLoading(false);
    }
  }, [companyId, intl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "ledger.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "ledger.description" })}</CardDescription>
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

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "ledger.chartOfAccounts" })}</CardTitle>
          <CardDescription>{activeCompany.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "common.code" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "common.name" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "common.type" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "ledger.subType" })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>{account.code}</TableCell>
                  <TableCell>{account.name}</TableCell>
                  <TableCell>{accountTypeLabel(account.accountType, intl)}</TableCell>
                  <TableCell>{accountSubTypeLabel(account.accountSubType, intl)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!loading && accounts.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "ledger.noAccounts" })}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "ledger.newJournalEntry" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "ledger.newJournalEntryDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <JournalEntryForm companyId={activeCompany.id} journals={journals} accounts={accounts} onCreated={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "ledger.journalEntries" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <JournalEntriesTable companyId={activeCompany.id} entries={entries} journals={journals} onPosted={refresh} />
          {!loading && entries.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "ledger.noJournalEntries" })}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "ledger.trialBalance" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "ledger.trialBalanceDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage({ id: "common.code" })}</TableHead>
                <TableHead>{intl.formatMessage({ id: "ledger.account" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "ledger.debit" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "ledger.credit" })}</TableHead>
                <TableHead className="text-right">{intl.formatMessage({ id: "ledger.balance" })}</TableHead>
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
            <p className="mt-2 text-sm text-muted-foreground">{intl.formatMessage({ id: "ledger.noPostedEntries" })}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
