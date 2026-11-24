import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useSearchParams } from "react-router-dom";
import type { AccountResponse, JournalEntryResponse, JournalResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/context/CompanyContext";
import { useOpenParam } from "@/hooks/useOpenParam";
import { AccountBalancesPanel } from "@/pages/ledger/AccountBalancesPanel";
import { JournalEntriesTable } from "@/pages/ledger/JournalEntriesTable";
import { ListRibbon } from "@/components/list/ListRibbon";
import { useListFilters } from "@/components/list/useListFilters";

const ENTRY_FILTERS = ["from", "to", "state"] as const;
import { JournalEntryDialog } from "@/pages/ledger/JournalEntryDialog";
import { JournalEntryGrid } from "@/pages/ledger/JournalEntryGrid";

export function Ledger() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [journals, setJournals] = useState<JournalResponse[]>([]);
  const [entries, setEntries] = useState<JournalEntryResponse[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  // Client request 2026-11-24: the journal entry list's ribbon (date, state) and totals.
  const entryFilters = useListFilters("journalEntries", ENTRY_FILTERS);
  const fromDate = entryFilters.values.from ?? "";
  const toDate = entryFilters.values.to ?? "";
  const sortOrder = searchParams.get("sortOrder") ?? "newest";
  const [openEntryId, setOpenEntryId] = useOpenParam("entry");
  const openEntry = openEntryId ? (entries.find((e) => e.id === openEntryId) ?? null) : null;

  const latestParams = useRef(searchParams);
  useEffect(() => {
    latestParams.current = searchParams;
  }, [searchParams]);

  function updateParams(mutate: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(latestParams.current);
    mutate(next);
    latestParams.current = next;
    setSearchParams(next, { replace: true });
  }

  function setDateFilter(key: string, value: string) {
    updateParams((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
  }

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const [accountsResult, journalsResult, entriesResult] = await Promise.all([
        apiClient.accountsAll(companyId),
        apiClient.journalsAll(companyId),
        apiClient.journalEntriesAll(companyId),
      ]);
      setAccounts(accountsResult);
      setJournals(journalsResult);
      setEntries(entriesResult);
      // A saved or posted entry moves the balances: reload the account-balances panel too.
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "ledger.loadError" })));
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
          <CardTitle>{intl.formatMessage({ id: "journalGrid.title" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <JournalEntryGrid companyId={activeCompany.id} journals={journals} accounts={accounts} onCreated={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "ledger.journalEntries" })}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ListRibbon
            controls={entryFilters}
            dateLabelId="journalEntries.date"
            selects={[{
              name: "state",
              labelId: "journalEntries.state",
              className: "w-36",
              options: ["Draft", "Posted", "Cancelled"].map((state) => ({ value: state, label: intl.formatMessage({ id: `enum.state.${state.toLowerCase()}` }) })),
            }]}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDateFilter("sortOrder", sortOrder === "oldest" ? "newest" : "oldest")}
            >
              {sortOrder === "oldest"
                ? intl.formatMessage({ id: "ledger.newestFirst" })
                : intl.formatMessage({ id: "ledger.oldestFirst" })}
            </Button>
          </ListRibbon>
          <JournalEntriesTable companyId={activeCompany.id} journals={journals} fromDate={fromDate} toDate={toDate} state={entryFilters.values.state || undefined} sortOrder={sortOrder === "oldest" ? "oldest" : "newest"} onPosted={refresh} onOpenEntry={(entry) => setOpenEntryId(entry.id)} />
          <JournalEntryDialog companyId={activeCompany.id} entry={openEntry} accounts={accounts} journals={journals} onClose={() => setOpenEntryId(null)} />
        </CardContent>
      </Card>

      <AccountBalancesPanel companyId={activeCompany.id} reloadKey={reloadKey} />
    </div>
  );
}
