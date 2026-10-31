import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Link, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { AccountResponse, JournalEntryResponse, JournalResponse, TrialBalanceLine } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { useCompany } from "@/context/CompanyContext";
import { AccountingTooltip } from "@/components/shared/AccountingTooltip";
import { PrintButton } from "@/components/shared/PrintButton";
import { JournalEntriesTable } from "@/pages/ledger/JournalEntriesTable";
import { JournalEntryGrid } from "@/pages/ledger/JournalEntryGrid";
import { downloadFileResponse } from "@/pages/reports/helpers";
import { ExportButton } from "@/pages/reports/shared";

const TRIAL_BALANCE_GRID_ID = "trialBalance";

function moneyColumn(key: keyof TrialBalanceLine & string, header: string): ColumnDef<TrialBalanceLine> {
  return {
    accessorKey: key,
    header,
    meta: { numeric: true },
    enableColumnFilter: false,
    cell: ({ getValue }) => (getValue() as number).toFixed(2),
  };
}

export function Ledger() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;
  const trialBalancePrintRef = useRef<HTMLDivElement>(null);

  const [accounts, setAccounts] = useState<AccountResponse[]>([]);
  const [journals, setJournals] = useState<JournalResponse[]>([]);
  const [entries, setEntries] = useState<JournalEntryResponse[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const fromDate = searchParams.get("fromDate") ?? "";
  const toDate = searchParams.get("toDate") ?? "";
  const sortOrder = searchParams.get("sortOrder") ?? "newest";
  const tbFrom = searchParams.get("tbFrom") ?? "";
  const tbTo = searchParams.get("tbTo") ?? "";
  const hasTrialBalancePeriod = !!(tbFrom || tbTo);
  const [exportingTrialBalance, setExportingTrialBalance] = useState(false);

  function setDateFilter(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (fromDate) result = result.filter((e) => e.date >= fromDate);
    if (toDate) result = result.filter((e) => e.date <= toDate);
    result = [...result].sort((a, b) =>
      sortOrder === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
    );
    return result;
  }, [entries, fromDate, toDate, sortOrder]);

  const refresh = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [accountsResult, journalsResult, entriesResult, trialBalanceResult] = await Promise.all([
        apiClient.accountsAll(companyId),
        apiClient.journalsAll(companyId),
        apiClient.journalEntriesAll(companyId),
        apiClient.trialBalance(companyId, tbFrom || undefined, tbTo || undefined),
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
  }, [companyId, intl, tbFrom, tbTo]);

  async function exportTrialBalance() {
    if (!companyId) return;
    setExportingTrialBalance(true);
    try {
      downloadFileResponse(await apiClient.trialBalanceExport(companyId, tbFrom || undefined, tbTo || undefined), "trial-balance.xlsx");
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.exportError" })));
    } finally {
      setExportingTrialBalance(false);
    }
  }

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
      ...(hasTrialBalancePeriod ? [moneyColumn("opening", intl.formatMessage({ id: "ledger.opening" }))] : []),
      {
        accessorKey: "debit",
        header: () => <>{intl.formatMessage({ id: "ledger.debit" })}<AccountingTooltip termKey="tooltip.debit" /></>,
        meta: { numeric: true },
        enableColumnFilter: false,
        cell: ({ getValue }) => (getValue() as number).toFixed(2),
      },
      {
        accessorKey: "credit",
        header: () => <>{intl.formatMessage({ id: "ledger.credit" })}<AccountingTooltip termKey="tooltip.credit" /></>,
        meta: { numeric: true },
        enableColumnFilter: false,
        cell: ({ getValue }) => (getValue() as number).toFixed(2),
      },
      hasTrialBalancePeriod
        ? moneyColumn("closing", intl.formatMessage({ id: "ledger.closing" }))
        : moneyColumn("balance", intl.formatMessage({ id: "ledger.balance" })),
    ],
    [intl, hasTrialBalancePeriod],
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
          <JournalEntriesTable companyId={activeCompany.id} entries={filteredEntries} journals={journals} onPosted={refresh} isLoading={loading} />
        </CardContent>
      </Card>

      <Card ref={trialBalancePrintRef}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{intl.formatMessage({ id: "ledger.trialBalance" })}<AccountingTooltip termKey="tooltip.trialBalance" /></CardTitle>
              <CardDescription>{intl.formatMessage({ id: "ledger.trialBalanceDescription" })}</CardDescription>
            </div>
            {trialBalance.length > 0 && (
              <div className="flex items-center gap-2">
                <ExportButton onClick={() => void exportTrialBalance()} loading={exportingTrialBalance} />
                <PrintButton contentRef={trialBalancePrintRef} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-4 pt-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="trial-balance-from" className="text-xs">{intl.formatMessage({ id: "reports.from" })}</Label>
              <Input id="trial-balance-from" type="date" value={tbFrom} onChange={(e) => setDateFilter("tbFrom", e.target.value)} className="h-8 w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="trial-balance-to" className="text-xs">{intl.formatMessage({ id: "reports.to" })}</Label>
              <Input id="trial-balance-to" type="date" value={tbTo} onChange={(e) => setDateFilter("tbTo", e.target.value)} className="h-8 w-40" />
            </div>
            {hasTrialBalancePeriod && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete("tbFrom");
                    next.delete("tbTo");
                    return next;
                  }, { replace: true });
                }}
              >
                {intl.formatMessage({ id: "ledger.clearFilters" })}
              </Button>
            )}
          </div>
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
