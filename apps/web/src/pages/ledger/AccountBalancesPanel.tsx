import { useQuery } from "@tanstack/react-query";
import { formatMoney } from "@/lib/amount";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { TrialBalanceLine } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { DataGrid } from "@/components/data-grid/DataGrid";
import { AccountingTooltip } from "@/components/shared/AccountingTooltip";
import { PrintButton } from "@/components/shared/PrintButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountPath } from "@/lib/entityLinks";
import { downloadFileResponse } from "@/pages/reports/helpers";
import { ExportButton } from "@/pages/reports/shared";

const TRIAL_BALANCE_GRID_ID = "trialBalance";

function moneyColumn(key: keyof TrialBalanceLine & string, header: React.ReactNode): ColumnDef<TrialBalanceLine> {
  return {
    accessorKey: key,
    header: () => header,
    meta: { numeric: true },
    enableColumnFilter: false,
    cell: ({ getValue }) => formatMoney((getValue() as number)),
  };
}

type AccountBalancesPanelProps = {
  companyId: string;
  /** Change to reload (e.g. after a journal entry is saved on the same page). */
  reloadKey?: unknown;
};

/**
 * Account balances ("Gjendja e llogarive"): code, name, group, opening, period debit/credit,
 * period balance and closing per account, from `ledger/trial-balance`. Period and the
 * zero-balance switch live in the URL (tbFrom, tbTo, tbZero) so the view can be linked.
 */
export function AccountBalancesPanel({ companyId, reloadKey }: AccountBalancesPanelProps) {
  const intl = useIntl();
  const printRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tbFrom = searchParams.get("tbFrom") ?? "";
  const tbTo = searchParams.get("tbTo") ?? "";
  const includeZero = searchParams.get("tbZero") === "1";
  const hasPeriod = !!(tbFrom || tbTo);

  const [lines, setLines] = useState<TrialBalanceLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const latestParams = useRef(searchParams);
  useEffect(() => {
    latestParams.current = searchParams;
  }, [searchParams]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(latestParams.current);
    if (value) next.set(key, value);
    else next.delete(key);
    latestParams.current = next;
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .trialBalance(companyId, tbFrom || undefined, tbTo || undefined, includeZero || undefined)
      .then((result) => {
        if (!cancelled) setLines(result);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err, intl.formatMessage({ id: "ledger.loadError" })));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, tbFrom, tbTo, includeZero, reloadKey, intl]);

  const totalsQuery = useQuery({
    queryKey: ["trialBalanceTotals", companyId, tbFrom, tbTo, reloadKey] as const,
    queryFn: () => apiClient.trialBalanceTotals(companyId, tbFrom || undefined, tbTo || undefined, undefined),
  });
  const totals = totalsQuery.data;

  async function exportBalances() {
    setExporting(true);
    try {
      downloadFileResponse(
        await apiClient.trialBalanceExport(companyId, tbFrom || undefined, tbTo || undefined, includeZero || undefined),
        "trial-balance.xlsx",
      );
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "reports.exportError" })));
    } finally {
      setExporting(false);
    }
  }

  const columns = useMemo<ColumnDef<TrialBalanceLine>[]>(
    () => [
      { accessorKey: "accountCode", header: intl.formatMessage({ id: "common.code" }) },
      { accessorKey: "accountName", header: intl.formatMessage({ id: "ledger.account" }) },
      {
        id: "groupName",
        accessorFn: (row) => row.groupName ?? "",
        header: intl.formatMessage({ id: "ledger.group" }),
      },
      moneyColumn("opening", intl.formatMessage({ id: "ledger.opening" })),
      moneyColumn("debit", <>{intl.formatMessage({ id: "ledger.debit" })}<AccountingTooltip termKey="tooltip.debit" /></>),
      moneyColumn("credit", <>{intl.formatMessage({ id: "ledger.credit" })}<AccountingTooltip termKey="tooltip.credit" /></>),
      moneyColumn("balance", intl.formatMessage({ id: "ledger.balance" })),
      moneyColumn("closing", intl.formatMessage({ id: "ledger.closing" })),
    ],
    [intl],
  );

  return (
    <Card ref={printRef}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              {intl.formatMessage({ id: "ledger.trialBalance" })}
              <AccountingTooltip termKey="tooltip.trialBalance" />
            </CardTitle>
            <CardDescription>{intl.formatMessage({ id: "ledger.trialBalanceDescription" })}</CardDescription>
          </div>
          {lines.length > 0 && (
            <div className="flex items-center gap-2">
              <ExportButton onClick={() => void exportBalances()} loading={exporting} />
              <PrintButton contentRef={printRef} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-4 pt-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="trial-balance-from" className="text-xs">{intl.formatMessage({ id: "reports.from" })}</Label>
            <Input id="trial-balance-from" type="date" value={tbFrom} onChange={(e) => setParam("tbFrom", e.target.value)} className="h-8 w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="trial-balance-to" className="text-xs">{intl.formatMessage({ id: "reports.to" })}</Label>
            <Input id="trial-balance-to" type="date" value={tbTo} onChange={(e) => setParam("tbTo", e.target.value)} className="h-8 w-40" />
          </div>
          <label className="flex h-8 items-center gap-2 text-sm">
            <Checkbox checked={includeZero} onChange={(e) => setParam("tbZero", e.target.checked ? "1" : "")} />
            {intl.formatMessage({ id: "ledger.showZeroAccounts" })}
          </label>
          {hasPeriod && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setParam("tbFrom", "");
                setParam("tbTo", "");
              }}
            >
              {intl.formatMessage({ id: "ledger.clearFilters" })}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataGrid
          gridId={TRIAL_BALANCE_GRID_ID}
          columns={columns}
          data={lines}
          rowCount={lines.length}
          isLoading={loading}
          getRowId={(row) => row.accountId}
          getRowLink={(row) => accountPath(row.accountId)}
          enableGlobalFilter
          emptyMessage={intl.formatMessage({ id: "ledger.noPostedEntries" })}
          exportFileName="trial-balance"
          footerRow={
            totals
              ? {
                  label: intl.formatMessage({ id: "common.total" }),
                  cells: {
                    opening: formatMoney(totals.opening),
                    debit: formatMoney(totals.debit),
                    credit: formatMoney(totals.credit),
                    balance: totals.balance != null ? formatMoney(totals.balance) : "",
                    closing: formatMoney(totals.closing),
                  },
                }
              : undefined
          }
          manualFiltering={false}
          manualSorting={false}
          manualGrouping={false}
          defaultPageSize={200}
          pageSizeOptions={[50, 100, 200, 500]}
        />
      </CardContent>
    </Card>
  );
}
