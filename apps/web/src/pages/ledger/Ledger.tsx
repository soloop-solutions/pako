import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { AccountResponse, JournalEntryResponse, JournalResponse, TrialBalanceLine } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useCompany } from "@/context/CompanyContext";
import { JournalEntriesTable } from "@/pages/ledger/JournalEntriesTable";
import { JournalEntryForm } from "@/pages/ledger/JournalEntryForm";

const TRIAL_BALANCE_GRID_ID = "trialBalance";

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

  const trialBalanceColumns = useMemo<ColumnDef<TrialBalanceLine>[]>(
    () => [
      {
        accessorKey: "accountCode",
        header: intl.formatMessage({ id: "common.code" }),
      },
      {
        accessorKey: "accountName",
        header: intl.formatMessage({ id: "ledger.account" }),
      },
      {
        accessorKey: "debit",
        header: intl.formatMessage({ id: "ledger.debit" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        cell: ({ getValue }) => (getValue() as number).toFixed(2),
      },
      {
        accessorKey: "credit",
        header: intl.formatMessage({ id: "ledger.credit" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        cell: ({ getValue }) => (getValue() as number).toFixed(2),
      },
      {
        accessorKey: "balance",
        header: intl.formatMessage({ id: "ledger.balance" }),
        meta: { numeric: true },
        enableColumnFilter: false,
        cell: ({ getValue }) => (getValue() as number).toFixed(2),
      },
    ],
    [intl],
  );

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
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({ id: "ledger.chartOfAccountsSummary" }, { count: accounts.length })}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/chart-of-accounts">{intl.formatMessage({ id: "ledger.openChartOfAccounts" })}</Link>
          </Button>
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
          <JournalEntriesTable companyId={activeCompany.id} entries={entries} journals={journals} onPosted={refresh} isLoading={loading} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "ledger.trialBalance" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "ledger.trialBalanceDescription" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataGrid
            gridId={TRIAL_BALANCE_GRID_ID}
            columns={trialBalanceColumns}
            data={trialBalance}
            rowCount={trialBalance.length}
            isLoading={loading}
            getRowId={(row) => row.accountId}
            enableGlobalFilter
            emptyMessage={intl.formatMessage({ id: "ledger.noPostedEntries" })}
            exportFileName="trial-balance"
            manualFiltering={false}
            manualSorting={false}
            manualGrouping={false}
            defaultPageSize={200}
            pageSizeOptions={[50, 100, 200, 500]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
