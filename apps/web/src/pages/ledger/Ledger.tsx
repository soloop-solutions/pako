import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useSearchParams } from "react-router-dom";
import type { AccountResponse, JournalEntryResponse, JournalResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useOpenParam } from "@/hooks/useOpenParam";
import { AccountBalancesPanel } from "@/pages/ledger/AccountBalancesPanel";
import { JournalEntriesTable } from "@/pages/ledger/JournalEntriesTable";
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
  const fromDate = searchParams.get("fromDate") ?? "";
  const toDate = searchParams.get("toDate") ?? "";
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
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{intl.formatMessage({ id: "ledger.fromDate" })}</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setDateFilter("fromDate", e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{intl.formatMessage({ id: "ledger.toDate" })}</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setDateFilter("toDate", e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDateFilter("sortOrder", sortOrder === "oldest" ? "newest" : "oldest")}
            >
              {sortOrder === "oldest"
                ? intl.formatMessage({ id: "ledger.newestFirst" })
                : intl.formatMessage({ id: "ledger.oldestFirst" })}
            </Button>
            {(fromDate || toDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete("fromDate");
                    next.delete("toDate");
                    return next;
                  }, { replace: true });
                }}
              >
                {intl.formatMessage({ id: "ledger.clearFilters" })}
              </Button>
            )}
          </div>
          <JournalEntriesTable companyId={activeCompany.id} journals={journals} fromDate={fromDate} toDate={toDate} sortOrder={sortOrder === "oldest" ? "oldest" : "newest"} onPosted={refresh} onOpenEntry={(entry) => setOpenEntryId(entry.id)} />
          <JournalEntryDialog companyId={activeCompany.id} entry={openEntry} accounts={accounts} journals={journals} onClose={() => setOpenEntryId(null)} />
        </CardContent>
      </Card>

      <AccountBalancesPanel companyId={activeCompany.id} reloadKey={reloadKey} />
    </div>
  );
}
