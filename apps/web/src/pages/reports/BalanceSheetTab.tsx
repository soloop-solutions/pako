import { useRef } from "react";
import { useIntl } from "react-intl";

import { PrintButton } from "@/components/shared/PrintButton";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountingTooltip } from "@/components/shared/AccountingTooltip";
import { cn } from "@/lib/utils";
import { accountPath } from "@/lib/entityLinks";
import { LinkedRow } from "./LinkedRow";
import { DrillAmount, ExportButton, LockNotice } from "./shared";
import { isOnOrBeforeLock } from "./helpers";
import { ComparativeBalanceSheet } from "./ComparativeBalanceSheet";
import type { useBalanceSheetReport } from "./useBalanceSheetReport";

export function BalanceSheetTab({ report, companyName, accountingLockDate }: { report: ReturnType<typeof useBalanceSheetReport>; companyName: string; accountingLockDate: string | undefined }) {
  const intl = useIntl();
  const printRef = useRef<HTMLDivElement>(null);
  const { compareTo, setCompareTo, comparative, exporter, asOf, setAsOf, balanceSheet, balanceSheetAsOf, balanceSheetError, balanceSheetLoading, loadBalanceSheet } = report;

  const balanceSheetLocked = !!balanceSheetAsOf && isOnOrBeforeLock(balanceSheetAsOf, accountingLockDate);

  return (
    <Card ref={printRef}>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "reports.balanceSheet" })}</CardTitle>
        <CardDescription>{companyName}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bs-as-of">{intl.formatMessage({ id: "reports.asOf" })}</Label>
            <Input id="bs-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bs-compare-to">{intl.formatMessage({ id: "reports.compareTo" })}</Label>
            <Input id="bs-compare-to" type="date" value={compareTo} onChange={(event) => setCompareTo(event.target.value)} />
          </div>
          <Button onClick={loadBalanceSheet} disabled={balanceSheetLoading}>
            {balanceSheetLoading ? intl.formatMessage({ id: "reports.loadingReport" }) : intl.formatMessage({ id: "reports.runReport" })}
          </Button>
                    <ExportButton onClick={exporter.exportFile} loading={exporter.exporting} />
          {(balanceSheet || comparative) && <PrintButton contentRef={printRef} />}
        </div>

        {balanceSheetLocked && <LockNotice lockDate={accountingLockDate ?? ""} messageId="reports.periodLockedAccounting" />}

        {balanceSheetError && (
          <Alert variant="destructive">
            <AlertDescription>{balanceSheetError}</AlertDescription>
          </Alert>
        )}

        {exporter.exportError && (
          <Alert variant="destructive">
            <AlertDescription>{exporter.exportError}</AlertDescription>
          </Alert>
        )}

        {comparative && <ComparativeBalanceSheet data={comparative} />}

        {balanceSheet && (
          <>
            {(
              [
                ["reports.assets", balanceSheet.assets, balanceSheet.totalAssets, "reports.totalAssets", "tooltip.assets"],
                ["reports.liabilities", balanceSheet.liabilities, balanceSheet.totalLiabilities, "reports.totalLiabilities", "tooltip.liabilities"],
                ["reports.equity", balanceSheet.equity, balanceSheet.totalEquity, "reports.totalEquity", "tooltip.equity"],
              ] as const
            ).map(([titleKey, lines, total, totalKey, tooltipKey]) => (
              <div key={titleKey}>
                <h3 className="mb-2 text-sm font-medium">{intl.formatMessage({ id: titleKey })}<AccountingTooltip termKey={tooltipKey} /></h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{intl.formatMessage({ id: "common.code" })}</TableHead>
                      <TableHead>{intl.formatMessage({ id: "ledger.account" })}</TableHead>
                      <TableHead className="text-right">{intl.formatMessage({ id: "common.amount" })}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <LinkedRow key={line.accountId} to={accountPath(line.accountId)}>
                        <TableCell>{line.accountCode}</TableCell>
                        <TableCell>{line.accountName}</TableCell>
                        <TableCell className="text-right"><DrillAmount amount={line.amount} accountCode={line.accountCode} /></TableCell>
                      </LinkedRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-1 text-right text-sm font-medium">
                  {intl.formatMessage({ id: totalKey }, { amount: total.toFixed(2) })}
                </p>
              </div>
            ))}

            <p
              className={cn(
                "text-sm font-medium",
                balanceSheet.difference === 0
                  ? "text-foreground"
                  : "text-destructive",
              )}
            >
              {intl.formatMessage(
                { id: "reports.balanceEquation" },
                {
                  assets: balanceSheet.totalAssets.toFixed(2),
                  liabilitiesPlusEquity: balanceSheet.totalLiabilitiesAndEquity.toFixed(2),
                },
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
