import { useState } from "react";
import { useIntl } from "react-intl";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/context/CompanyContext";
import { cn } from "@/lib/utils";
import { buildRollForward, type RollForward } from "@/pages/year-end/rollForward";

// F12, Part 1 — a real, read-only roll-forward VIEW, not a "close the year" action. There is zero
// fiscal-year/closing concept anywhere in backend/ (no FiscalYear/YearEnd/RollForward/ClosingEntry
// table or endpoint of any kind — confirmed by reading the backend directly, not assumed). Building
// a client-side "generate closing entries" button on top of that would be actively misleading: an
// accountant could believe their year is closed when nothing happened server-side. So this screen
// does exactly one honest thing — call the real, already-shipped
// GET .../reports/balance-sheet?asOf= endpoint twice (Dec 31 of the previous year, Dec 31 of the
// selected year) and show the difference as the year's movement. Kosovo's fiscal year is the
// calendar year, same assumption the rest of this app's date handling already makes.
function fiscalYearNow(): number {
  return new Date().getFullYear();
}

function equationOk(assets: number, liabilities: number, equity: number): boolean {
  return Math.abs(assets - (liabilities + equity)) < 0.01;
}

export function YearEnd() {
  const intl = useIntl();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id ?? null;

  const [year, setYear] = useState<number>(fiscalYearNow);
  const [rollForward, setRollForward] = useState<RollForward | null>(null);
  const [period, setPeriod] = useState<{ beginning: string; ending: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!companyId) return;
    setError(null);
    setLoading(true);
    const beginningAsOf = `${year - 1}-12-31`;
    const endingAsOf = `${year}-12-31`;
    try {
      const [beginning, ending] = await Promise.all([
        apiClient.balanceSheet(companyId, beginningAsOf),
        apiClient.balanceSheet(companyId, endingAsOf),
      ]);
      setRollForward(buildRollForward(beginning, ending));
      setPeriod({ beginning: beginningAsOf, ending: endingAsOf });
    } catch (err) {
      setError(getApiErrorMessage(err, intl.formatMessage({ id: "yearEnd.loadError" })));
    } finally {
      setLoading(false);
    }
  }

  if (!activeCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "yearEnd.title" })}</CardTitle>
          <CardDescription>{intl.formatMessage({ id: "yearEnd.description" })}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "common.selectCompanyFirst" })}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{intl.formatMessage({ id: "yearEnd.title" })}</CardTitle>
          <CardDescription>
            {activeCompany.name} — {intl.formatMessage({ id: "yearEnd.description" })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="year-end-fiscal-year">{intl.formatMessage({ id: "yearEnd.fiscalYear" })}</Label>
              <Input
                id="year-end-fiscal-year"
                type="number"
                value={year}
                onChange={(event) => setYear(parseInt(event.target.value, 10) || fiscalYearNow())}
                className="w-28"
              />
            </div>
            <Button onClick={() => void run()} disabled={loading}>
              {loading ? intl.formatMessage({ id: "reports.loadingReport" }) : intl.formatMessage({ id: "reports.runReport" })}
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {rollForward && period && (
            <>
              {(
                [
                  ["reports.assets", rollForward.assets, rollForward.totalBeginningAssets, rollForward.totalEndingAssets],
                  ["reports.liabilities", rollForward.liabilities, rollForward.totalBeginningLiabilities, rollForward.totalEndingLiabilities],
                  ["reports.equity", rollForward.equity, rollForward.totalBeginningEquity, rollForward.totalEndingEquity],
                ] as const
              ).map(([titleKey, lines, totalBeginning, totalEnding]) => {
                return (
                  <div key={titleKey}>
                    <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: titleKey })}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{intl.formatMessage({ id: "common.code" })}</TableHead>
                          <TableHead>{intl.formatMessage({ id: "ledger.account" })}</TableHead>
                          <TableHead className="text-right">{intl.formatMessage({ id: "yearEnd.beginningBalance" }, { date: period.beginning })}</TableHead>
                          <TableHead className="text-right">{intl.formatMessage({ id: "yearEnd.movement" })}</TableHead>
                          <TableHead className="text-right">{intl.formatMessage({ id: "yearEnd.endingBalance" }, { date: period.ending })}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => (
                          <TableRow key={line.accountId}>
                            <TableCell>{line.accountCode}</TableCell>
                            <TableCell>{line.accountName}</TableCell>
                            <TableCell className="text-right tabular-nums">{line.beginning.toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">{line.movement.toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">{line.ending.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="mt-1 text-right text-sm font-medium tabular-nums">
                      {intl.formatMessage({ id: "yearEnd.totalMovement" }, { amount: (totalEnding - totalBeginning).toFixed(2) })}
                    </p>
                  </div>
                );
              })}

              <div className="flex flex-col gap-1 text-sm font-medium">
                <p
                  className={cn(
                    equationOk(rollForward.totalBeginningAssets, rollForward.totalBeginningLiabilities, rollForward.totalBeginningEquity)
                      ? "text-foreground"
                      : "text-destructive",
                  )}
                >
                  {intl.formatMessage({ id: "yearEnd.beginningBalance" }, { date: period.beginning })}:{" "}
                  {intl.formatMessage(
                    { id: "reports.balanceEquation" },
                    {
                      assets: rollForward.totalBeginningAssets.toFixed(2),
                      liabilitiesPlusEquity: (rollForward.totalBeginningLiabilities + rollForward.totalBeginningEquity).toFixed(2),
                    },
                  )}
                </p>
                <p
                  className={cn(
                    equationOk(rollForward.totalEndingAssets, rollForward.totalEndingLiabilities, rollForward.totalEndingEquity)
                      ? "text-foreground"
                      : "text-destructive",
                  )}
                >
                  {intl.formatMessage({ id: "yearEnd.endingBalance" }, { date: period.ending })}:{" "}
                  {intl.formatMessage(
                    { id: "reports.balanceEquation" },
                    {
                      assets: rollForward.totalEndingAssets.toFixed(2),
                      liabilitiesPlusEquity: (rollForward.totalEndingLiabilities + rollForward.totalEndingEquity).toFixed(2),
                    },
                  )}
                </p>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1 rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
            <p className="font-medium">{intl.formatMessage({ id: "yearEnd.closingNotAvailableTitle" })}</p>
            <p>{intl.formatMessage({ id: "yearEnd.closingNotAvailablePlaceholder" })}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
